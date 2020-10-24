const bodyParser = require("body-parser");
const cors = require("cors");
const express = require("express");

const binanceAPI = require("./binance-API-wrapper.js");

// GLOBAL
const PORT = process.env.PORT || 3000;

const STOP_LIMIT_PERCENT = 0.65; // Percentage above/below current price to set stop loss
const RECV_WINDOW = 20000;       // Time (ms) to wait for response from Binance server
const LOT_SIZE_QTY = 6;          // Highest precision Binance allows for quantities
const LOT_SIZE_PRICE = 6;        // Highest precision Binance allows for price/limit
const QTY_FACTOR = 20;           // Total balance is divided by this when setting quantity on orders

var balances = [];

// SERVER CONFIG
const app = express();
app.use(cors());
app.use(bodyParser.json());


// GET CURRENT ACCOUNT BALANCES
updateBalances().then( (balanceRes) => 
{
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


// FUNCTIONS //

// getBalanceBySymbol() - Retrieve Binance account balance for the provided symbol
function getBalanceBySymbol(symbol)
{
    return parseFloat(balances.find( (elem) => { return elem.asset == symbol; }).free); 
}


// placeOrderAndStopLoss() - Place the appropriate buy/sell Market order and Stop Limit order
function placeOrderAndStopLoss(baseCur, quoteCur, currentPrice, marketSide)
{
    let priceLimit = 0.0, stopLimit = 0.0, market_qty = 0.0, limit_qty = 0.0;
    let stopSide = "";

    // Setup order values based on the market side (and consequently the "crossing" type)
    if (marketSide === "SELL")     
    { 
        stopSide = "BUY"; 
        market_qty = (getBalanceBySymbol(baseCur) / QTY_FACTOR).toFixed(LOT_SIZE_QTY); 
        priceLimit = currentPrice + ((currentPrice / 100.0) * STOP_LIMIT_PERCENT);
        stopLimit = (priceLimit - 0.00001).toFixed(LOT_SIZE_PRICE);
    }
    else if (marketSide === "BUY") 
    { 
        stopSide = "SELL"; 
        market_qty = (getBalanceBySymbol(quoteCur) / QTY_FACTOR).toFixed(LOT_SIZE_QTY);
        priceLimit = currentPrice - ((currentPrice / 100.0) * STOP_LIMIT_PERCENT);
        stopLimit = (priceLimit + 0.00001).toFixed(LOT_SIZE_PRICE);
    }

    // Put in a MARKET order at current price
    binanceAPI.postOrder(baseCur + quoteCur, marketSide, "MARKET", "", market_qty, 0, 0, RECV_WINDOW).then( (sellRes) => 
    {
        if (sellRes) 
        {  
            updateBalances().then( (balanceRes) => 
            {
                balances = balanceRes;
                if (marketSide === "SELL") { limit_qty = (getBalanceBySymbol(quoteCur) / QTY_FACTOR).toFixed(LOT_SIZE_QTY); }
                else                       { limit_qty = (getBalanceBySymbol(baseCur) / QTY_FACTOR).toFixed(LOT_SIZE_QTY); }

                // Place a Stop Limit order based on STOP_LIMIT_PERCENT
                priceLimit = priceLimit.toFixed(LOT_SIZE_PRICE);
                console.info("Limit Qty: " + limit_qty + ", Market Side: " + marketSide + ", Price Limit: " + priceLimit);
                binanceAPI.postOrder(baseCur + quoteCur, stopSide, "STOP_LOSS_LIMIT", "GTC", limit_qty, priceLimit, stopLimit, RECV_WINDOW).then( (limitRes) => 
                { 
                    if (limitRes) { console.info(new Date(Date.now()).toISOString() + ": " + "Placed a " + marketSide + " order @ " + currentPrice + ". Set Stop Loss @ " + priceLimit); }

                    // If the limit order fails to place for any reason, try placing the opposite Market order to be on the safe side
                    binanceAPI.postOrder(baseCur + quoteCur, stopSide, "MARKET", "", market_qty, 0, 0, RECV_WINDOW).then( (panicRes) => 
                    {
                        if (panicRes) { console.info(new Date(Date.now()).toISOString() + ": " + "Failed to place Stop Limit order! Rebought/sold Market order @ " + priceLimit); }
                    });

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


// updateBalances() - Retrieve the current balance info from Binance
function updateBalances()
{
    return new Promise( (resolve, reject) => 
    {
        binanceAPI.getAccountInfo(RECV_WINDOW).then( (res) => 
        { 
            if (res) { resolve(res.balances);  }
            else {reject ("Failed to get account balances."); }
        });
    });
}