const bodyParser = require("body-parser");
const cors = require("cors");
const express = require("express");

const binanceAPI = require("./binance-API-wrapper.js");

// GLOBAL
const PORT = process.env.PORT || 3000;

const BINANCE_FEE = 0.001;       // Binance trading fee amount
const STOP_LIMIT_PERCENT = 0.50; // Percentage above/below current price to set stop loss
const MAJOR_STEP_SIZES = {       // Step sizes for major quote assets
    "BTC": 0.000001, 
    "ETH": 0.000001, 
    "USDT": 0.01 
};
const RECV_WINDOW = 10000;       // Time (ms) to wait for response from Binance server       
const MAX_RETRIES = 10;          // Max # of retries to place Stop Loss order before Market order will be rebought/sold
const QTY_FACTOR = 4;            // Total balance is divided by this when setting quantity on orders

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
            const baseCur = req.body.base;
            const quoteCur = req.body.quote;
            let crossType = "", found = "";

            // INDICATOR CROSS ("BULL" or "BEAR")
            if (req.body.crossType) 
            { 
                crossType = req.body.crossType; 

                // BULLISH //
                if (crossType === "BULL")
                {
                    console.info("\n" + new Date(Date.now()).toISOString() + ": " + baseCur + quoteCur + " " + time_interval + " BULL Cross");

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
                                            if (cancelRes) { placeOrderAndStopLoss(baseCur, quoteCur, "BUY"); }
                                        });
                                    }

                                    // Not in profit, cross occured between our Stop Limit and the price we sold at
                                    else { console.info(new Date(Date.now()).toISOString() + ": " + "Cross at a loss! Hanging tight..."); }
                                }); 
                            }
                            else { console.info(new Date(Date.now()).toISOString() + ": " + "Still waiting for BEAR cross. No action taken."); }
                        }
                    
                        // There are no open orders for this trading pair, place a BUY order
                        else { placeOrderAndStopLoss(baseCur, quoteCur, "BUY"); }  
                    });  
                }

                // BEARISH //
                else if (crossType === "BEAR")
                {
                    console.info("\n" + new Date(Date.now()).toISOString() + ": " + baseCur + quoteCur + " " + time_interval + " BEAR Cross");

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
                                            if (cancelRes) { placeOrderAndStopLoss(baseCur, quoteCur, "SELL"); }
                                        });
                                    }

                                    // Not in profit, cross occured between our Stop Limit and the price we bought at
                                    else { console.info(new Date(Date.now()).toISOString() + ": " + "Cross at a loss! Hanging tight..."); }
                                }); 
                            }
                            else { console.info(new Date(Date.now()).toISOString() + ": " + "Still waiting for BULL cross. No action taken."); }
                        }
                    
                        // There are no open orders for this trading pair, place a SELL order
                        else { placeOrderAndStopLoss(baseCur, quoteCur, "SELL"); }  
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
async function placeOrderAndStopLoss(baseCur, quoteCur, marketSide)
{
    var priceLimit = 0.0, stopLimit = 0.0, market_qty = 0.0, limit_qty = 0.0;
    var stepSizeBase = 0, stepSizeQuote = 0, stepBaseDec = 0, stepQuoteDec = 0;;
    var stopSide = "";

    // Get stepSize of base and quote assets so we know what precision to use in our order
    if (!(baseCur in MAJOR_STEP_SIZES)) { stepSizeBase = await getStepSize(baseCur, quoteCur); }
    else                                { stepSizeBase = MAJOR_STEP_SIZES[baseCur]; }
    stepSizeQuote = MAJOR_STEP_SIZES[quoteCur];

    // Get stepSize scales
    stepBaseDec = getNumDecimals(stepSizeBase);
    stepQuoteDec = getNumDecimals(stepSizeQuote);

    // Get the current ticker price
    let current_price = await binanceAPI.getCurrentPrice(baseCur + quoteCur);
    current_price = parseFloat(current_price.price);

    // Setup order values based on the market side (and consequently the "crossing" type)
    if (marketSide === "SELL")     
    { 
        stopSide = "BUY"; 
        market_qty = getBalanceBySymbol(baseCur) / QTY_FACTOR;
        priceLimit = current_price + ((current_price / 100.0) * STOP_LIMIT_PERCENT);
        stopLimit = truncateFloat((priceLimit - stepSizeQuote), stepQuoteDec);
    }
    else if (marketSide === "BUY") 
    { 
        stopSide = "SELL"; 
        market_qty = getBalanceBySymbol(quoteCur) / current_price;
        priceLimit = current_price - ((current_price / 100.0) * STOP_LIMIT_PERCENT);
        stopLimit = truncateFloat((priceLimit + stepSizeQuote), stepQuoteDec);
    }

    // Subtract off fees from order quantity (and an additional "stepSize" for consistency's sake)
    market_qty -= (market_qty * BINANCE_FEE);
    market_qty -= stepSizeBase;
    market_qty = truncateFloat(market_qty, stepBaseDec);
    priceLimit = truncateFloat(priceLimit, stepQuoteDec);

    // For whatever reason, subtracting the 0.1% fee AND a little extra is still not enough sometimes. Maybe it's a timing thing, maybe there
    // are other weird, hidden fees. Idk. We'll just keep retrying with slightly lower quantities until Binance is happy...
    let num_tries = 0; let sellRes = null;
    while(!sellRes)
    {
        // Put in a MARKET order at current price
        sellRes = await binanceAPI.postOrder(baseCur + quoteCur, marketSide, "MARKET", "", market_qty, 0, 0, RECV_WINDOW);

        if (!sellRes)
        {
            // Failed to place order, try again with a lower quantity
            if (num_tries < MAX_RETRIES)
            {
                num_tries += 1;
                market_qty -= stepSizeBase;
                market_qty = truncateFloat(market_qty, stepBaseDec);
                // console.info(new Date(Date.now()).toISOString() + ": " + "Retrying Market order with lower quantity: " + market_qty + " " + baseCur);
            }

            // Market order failed (we probably don't have enough of the required currency)
            else 
            { 
                console.info(new Date(Date.now()).toISOString() + ": " + "Failed to place " + marketSide + " order. Check account balance."); 
                sellRes = 1;
            }
        }
    }

    if (num_tries < MAX_RETRIES)
    {
        // Get updated account balance information after placing Market order
        let balanceRes = await updateBalances();
        balances = balanceRes;

        // Running these here to shave off as much time as possible between getting updated price and everything that comes after
        let new_quote_amt = getBalanceBySymbol(quoteCur);
        let new_base_amt = getBalanceBySymbol(baseCur);

        // Get updated ticker price
        let new_price = await binanceAPI.getCurrentPrice(baseCur + quoteCur);
        new_price = parseFloat(new_price.price);

        // Note: For BUY-side Stop Limit orders, we need to convert quote currency amount into base currency amount
        if (marketSide === "SELL") { limit_qty = new_quote_amt / new_price; }
        else                       { limit_qty = new_base_amt / QTY_FACTOR; }

        // Subtract off fees from quantity 
        limit_qty -= (limit_qty * BINANCE_FEE);
        limit_qty -= stepSizeBase;
        limit_qty = truncateFloat(limit_qty, stepBaseDec);

        // Same as for the Market order, we want to ensure the Stop Limit order is placed by retrying with lower quantities if it fails
        num_tries = 0; let limitRes = null;
        while(!limitRes)
        {
            // Place a Stop Limit order based on STOP_LIMIT_PERCENT
            limitRes = await binanceAPI.postOrder(baseCur + quoteCur, stopSide, "STOP_LOSS_LIMIT", "GTC", limit_qty, priceLimit, stopLimit, RECV_WINDOW);

            if (!limitRes)
            {
                // Failed to place order, try again with a lower quantity
                if (num_tries < MAX_RETRIES)
                {
                    num_tries += 1;
                    limit_qty -= stepSizeBase;
                    limit_qty = truncateFloat(limit_qty, stepBaseDec);
                    // console.info(new Date(Date.now()).toISOString() + ": " + "Retrying Stop Limit order with lower quantity: " + limit_qty + " " + baseCur);
                }

                // Something else is going wrong, rebuy/sell the Market order to be safe
                else
                {
                    let panicRes = await binanceAPI.postOrder(baseCur + quoteCur, stopSide, "MARKET", "", market_qty, 0, 0, RECV_WINDOW);
                    if (panicRes) { console.info(new Date(Date.now()).toISOString() + ": " + "Failed to place Stop Limit order! Rebought/sold Market order."); }
                    limitRes = 1;
                }
            }
        }
        if (num_tries < MAX_RETRIES) { console.info(new Date(Date.now()).toISOString() + ": " + "Placed a " + marketSide + " order @ " + new_price + ". Set Stop Loss @ " + priceLimit); }
    }
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
