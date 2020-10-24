const bodyParser = require("body-parser");
const cors = require("cors");
const express = require("express");

const binanceAPI = require("./binance-API-wrapper.js");

// GLOBAL
const PORT = process.env.PORT || 3000;

const STOP_LIMIT_PERCENT = 0.65; // Percentage above/below current price to set stop loss
const MAJOR_STEP_SIZES = {       // Step sizes for major quote assets
    "BTC": 0.000001, 
    "ETH": 0.000001, 
    "USDT": 0.01 
};
const RECV_WINDOW = 20000;       // Time (ms) to wait for response from Binance server       
const QTY_FACTOR = 30;           // Total balance is divided by this when setting quantity on orders

var balances = [];

// SERVER CONFIG
const app = express();
app.use(cors());
app.use(bodyParser.json());


// GET CURRENT ACCOUNT BALANCES
updateBalances().then( (balanceRes) => 
{
    balances = balanceRes;

    // START REST SERVER
    app.listen(PORT, () => 
    {
        console.info(new Date(Date.now()).toISOString() + ": Started local server on port " + PORT + ".");
    });


    // ROUTES
    app.post("/", (req, res) => 
    {
        if (res.statusCode != 200) { console.error(new Date(Date.now()).toISOString() + ": ERROR - TradingView POST failed. Response code: " + res.statusCode); }

        else if (req.body.time && req.body.base && req.body.quote) 
        { 
            // Retrieve data from request body
            const time_interval = req.body.time;
            const baseCur = req.body.base.toString();
            const quoteCur = req.body.quote.toString();
            let crossType = "", found = "";

            // INDICATOR CROSS ("BULL" or "BEAR")
            if (req.body.crossType) 
            { 
                crossType = req.body.crossType; 

                // BULLISH //
                if (crossType === "BULL")
                {
                    console.info("\n" + new Date(Date.now()).toISOString() + ": " + baseCur + " " + time_interval + " BULL Cross");

                    // Check if we have any open Stop Limit orders...
                    binanceAPI.getOpenOrders(baseCur + quoteCur, RECV_WINDOW).then( (orders) => 
                    { 
                        if (orders.length > 0) { found = orders.find( (order) => { return order.symbol == baseCur + quoteCur }); }
                        
                        // There is as an existing open order for this trading pair
                        if (found != "")
                        {
                            // We only care if it's a BUY-side Stop Limit... otherwise, we're just waiting for a BEARISH cross anyway
                            if (found.side == "BUY")
                            { 
                                binanceAPI.getCurrentPrice(baseCur + quoteCur).then( (priceData) => 
                                {
                                    // Check to see if our current price is LESS THAN the price when we sold, to make sure we're in profit
                                    let currentPrice = parseFloat(priceData.price);
                                    let orig_price = found.price / (1.0 + (STOP_LIMIT_PERCENT / 100.0));
                                    if (currentPrice <= orig_price)
                                    {
                                        // Cancel the old BUY Stop Limit
                                        binanceAPI.cancelOrder(baseCur + quoteCur, found.orderId, RECV_WINDOW).then ( (cancelRes) => 
                                        {
                                            if (cancelRes) { placeOrderAndStopLoss(baseCur, quoteCur, currentPrice, "BUY"); }
                                        });
                                    }

                                    // Not in profit, cross occured between our Stop Limit and the price we sold at
                                    else { cancelNoProfitOrder(baseCur, quoteCur, found.orderId); }
                                }); 
                            }
                        }
                    
                        // There are no open orders for this trading pair, place a BUY order
                        else
                        {   
                            binanceAPI.getCurrentPrice(baseCur + quoteCur).then( (priceData) => 
                            {
                                placeOrderAndStopLoss(baseCur, quoteCur, parseFloat(priceData.price), "BUY");
                            });
                        }  
                    });  
                }

                // BEARISH //
                else if (crossType === "BEAR")
                {
                    console.info("\n" + new Date(Date.now()).toISOString() + ": " + baseCur + " " + time_interval + " BEAR Cross");

                    // Check if we have any open Stop Limit orders...
                    binanceAPI.getOpenOrders(baseCur + quoteCur, RECV_WINDOW).then( (orders) => 
                    { 
                        if (orders.length > 0) { found = orders.find( (order) => { return order.symbol == baseCur + quoteCur }); }
                        
                        // There is as an existing open order for this trading pair
                        if (found != "")
                        {
                            // We only care if it's a SELL-side Stop Limit... otherwise, we're just waiting for a BULLISH cross anyway
                            if (found.side == "SELL")
                            { 
                                binanceAPI.getCurrentPrice(baseCur + quoteCur).then( (priceData) => 
                                {
                                    // Check to see if our current price is GREATER THAN the price when we bought, to make sure we're in profit
                                    let currentPrice = parseFloat(priceData.price);
                                    let orig_price = found.price / (1.0 - (STOP_LIMIT_PERCENT / 100.0));
                                    if (currentPrice >= orig_price)
                                    {
                                        // Cancel the old SELL Stop Limit
                                        binanceAPI.cancelOrder(baseCur + quoteCur, found.orderId, RECV_WINDOW).then ( (cancelRes) => 
                                        {
                                            if (cancelRes) { placeOrderAndStopLoss(baseCur, quoteCur, currentPrice, "SELL"); }
                                        });
                                    }

                                    // Not in profit, cross occured between our Stop Limit and the price we sold at
                                    else { cancelNoProfitOrder(baseCur, quoteCur, found.orderId); }
                                }); 
                            }
                        }
                    
                        // There are no open orders for this trading pair, place a SELL order
                        else
                        {   
                            binanceAPI.getCurrentPrice(baseCur + quoteCur).then( (priceData) => 
                            {
                                placeOrderAndStopLoss(baseCur, quoteCur, parseFloat(priceData.price), "SELL");
                            });
                        }  
                    });
                }
            }
        }

        else { console.error("ERROR: Request body did not contain the required parameters."); }
    });
});



///////////////
// FUNCTIONS //
///////////////

// placeOrderAndStopLoss() - Place the appropriate buy/sell Market order and Stop Limit order
async function placeOrderAndStopLoss(baseCur, quoteCur, currentPrice, marketSide)
{
    let priceLimit = 0.0, stopLimit = 0.0, market_qty = 0.0, limit_qty = 0.0;
    let stepSizeBase = 0, stepSizeQuote = 0, stepBaseDec = 0, stepQuoteDec = 0;;
    let stopSide = "";

    // Get stepSize of base and quote assets so we know what precision to use in our order
    if (!(baseCur in MAJOR_STEP_SIZES)) { stepSizeBase = await getStepSize(baseCur, quoteCur); }
    else                                { stepSizeBase = MAJOR_STEP_SIZES[baseCur]; }
    stepSizeQuote = MAJOR_STEP_SIZES[quoteCur];

    // Get stepSize scales
    stepBaseDec = getNumDecimals(stepSizeBase);
    stepQuoteDec = getNumDecimals(stepSizeQuote);

    // Setup order values based on the market side (and consequently the "crossing" type)
    if (marketSide === "SELL")     
    { 
        stopSide = "BUY"; 
        market_qty = truncateFloat((getBalanceBySymbol(baseCur) / QTY_FACTOR), stepBaseDec);
        priceLimit = currentPrice + ((currentPrice / 100.0) * STOP_LIMIT_PERCENT);
        stopLimit = truncateFloat((priceLimit - stepSizeQuote), stepQuoteDec);
    }
    else if (marketSide === "BUY") 
    { 
        stopSide = "SELL"; 
        market_qty = truncateFloat((getBalanceBySymbol(quoteCur) / currentPrice), stepBaseDec);
        priceLimit = currentPrice - ((currentPrice / 100.0) * STOP_LIMIT_PERCENT);
        stopLimit = truncateFloat((priceLimit + stepSizeQuote), stepQuoteDec);
    }

    // Put in a MARKET order at current price
    binanceAPI.postOrder(baseCur + quoteCur, marketSide, "MARKET", "", market_qty, 0, 0, RECV_WINDOW).then( (sellRes) => 
    {
        if (sellRes) 
        {  
            // Get new account balance information after placing Market order
            updateBalances().then( (balanceRes) => 
            {
                balances = balanceRes;

                // Note: For BUY-side Stop Limit orders, we need to convert quote currency amount into base currency amount
                if (marketSide === "SELL") { limit_qty = truncateFloat((getBalanceBySymbol(quoteCur) / currentPrice), stepBaseDec); }
                else                       { limit_qty = truncateFloat((getBalanceBySymbol(baseCur) / QTY_FACTOR), stepBaseDec); }

                // Place a Stop Limit order based on STOP_LIMIT_PERCENT
                priceLimit = truncateFloat(priceLimit, stepQuoteDec);
                binanceAPI.postOrder(baseCur + quoteCur, stopSide, "STOP_LOSS_LIMIT", "GTC", limit_qty, priceLimit, stopLimit, RECV_WINDOW).then( (limitRes) => 
                { 
                    if (limitRes) { console.info(new Date(Date.now()).toISOString() + ": " + "Placed a " + marketSide + " order @ ~" + currentPrice + ". Set Stop Loss @ " + priceLimit); }

                    // If the limit order fails, rebuy/sell to be on the safe side
                    else
                    {
                        binanceAPI.postOrder(baseCur + quoteCur, stopSide, "MARKET", "", market_qty, 0, 0, RECV_WINDOW).then( (panicRes) => 
                        {
                            if (panicRes) { console.info(new Date(Date.now()).toISOString() + ": " + "Failed to place Stop Limit order! Rebought/sold Market order."); }
                        });
                    }
                });
            });
        }

        // Market order failed (probably we don't have enough of the required currency)
        else { console.info(new Date(Date.now()).toISOString() + ": " + "Failed to place " + marketSide + " order. Check account balance."); }
    });
}


// cancelNoProfitOrder() - Cancel active stop limit order based on orderId (not in profit)
function cancelNoProfitOrder(baseCur, quoteCur, orderId)
{
    binanceAPI.cancelOrder(baseCur + quoteCur, orderId, RECV_WINDOW).then ( (cancelRes) => 
    {
        if (cancelRes) { console.info(new Date(Date.now()).toISOString() + ": " + "Cross at a loss! Cancelled old limit order."); }
    });
}


// getBalanceBySymbol() - Retrieve Binance account balance for the provided symbol
function getBalanceBySymbol(symbol)
{
    return parseFloat(balances.find( (elem) => { return elem.asset == symbol; }).free); 
}


// updateBalances() - Retrieve the current balance info from Binance
function updateBalances()
{
    return new Promise( (resolve, reject) => 
    {
        binanceAPI.getAccountInfo(RECV_WINDOW).then( (res) => 
        { 
            if (res) { resolve(res.balances); }
            else { reject ("Failed to get account balances."); }
        });
    }).catch( (err) => { console.error(err); });
}


// getStepSize() - Return the stepSize for a base asset
function getStepSize(baseCur, quoteCur)
{
    return new Promise( (resolve, reject) => 
    {
        binanceAPI.getExchangeInfo().then( (res) => 
        {
            if (res)
            {
                let symbol_info = res.symbols.find( (trading_pair) => { return trading_pair.symbol == baseCur + quoteCur; });
                let stepSize = symbol_info.filters.find( (filter) => { return filter.filterType == "LOT_SIZE"; }).stepSize;
                resolve(stepSize);
            }
            else { reject("Failed to get step size."); }
        })
    }).catch( (err) => { console.error(err); });
}


// getNumDecimals() - Return number of decimals in a floating point number
function getNumDecimals(num)
{
    return parseFloat(num).toString().split(".")[1].length;
}


// truncateFloat() - Truncates float to specified number of decimals without rounding
function truncateFloat(num, decNum)
{
    let re = new RegExp('^-?\\d+(?:\.\\d{0,' + (decNum || -1) + '})?'); // Credit: guya, Stack Overflow
    return parseFloat(num.toString().match(re)[0]);
}
