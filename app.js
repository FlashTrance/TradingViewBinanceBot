const bodyParser = require("body-parser");
const cors = require("cors");
const express = require("express");

const binanceAPI = require("./binance-API-wrapper.js");

// GLOBAL
const PORT = process.env.PORT || 3000;

const STOP_LIMIT_PERCENT = 1;
const TEST_FACTOR = 20;
const RECV_WINDOW = 20000;

var balances = [];

// SERVER CONFIG
const app = express();
app.use(cors());
app.use(bodyParser.json());


// GET CURRENT ACCOUNT BALANCES
binanceAPI.getAccountInfo(RECV_WINDOW).then( (res, err) => 
{ 
    if (err) { throw err; }
    else     { balances = res.balances; }

}).then( () => 
{
    // START REST SERVER
    app.listen(PORT, () => 
    {
        console.info(new Date(Date.now()).toISOString() + ": Started local server on port " + PORT + ".");
    });


    // ROUTES
    app.post("/", (req, res) => 
    {
        if (res.statusCode != 200) { console.error("ERROR: Trading View POST failed. Response code: " + res.statusCode); }

        else if (req.body.time && req.body.currency) 
        { 
            // Get data from request body
            const time_interval = req.body.time;
            const ticker = req.body.currency;
            let crossType = "", found = "";

            // EMA CROSS - When EMA 10 crosses up EMA 20, it's a bullish cross (and vice versa)
            if (req.body.crossType) 
            { 
                crossType = req.body.crossType; 

                // BULLISH
                if (crossType === "BULL")
                {
                    console.info("\n" + new Date(Date.now()).toISOString() + ": " + ticker + " " + time_interval + " BULL Cross");

                    // Check if we have any open Stop Limit orders...
                    binanceAPI.getOpenOrders(ticker + "BTC", RECV_WINDOW).then( (orders) => 
                    { 
                        if (orders.length > 0) { found = orders.find( (order) => { return order.symbol == ticker + "BTC" }); }
                        
                        // There is as an existing open order for this trading pair
                        if (found != "")
                        {
                            // We only care if it's a BUY-side Stop Limit... otherwise, we're just waiting for a BEARISH cross anyway
                            if (found.side == "BUY")
                            { 
                                binanceAPI.getCurrentPrice(ticker + "BTC").then( (priceData) => 
                                {
                                    // Check to see if our current price is LESS THAN the price when we sold, to make sure we're in profit.
                                    let orig_price = found.price / (1.0 + (STOP_LIMIT_PERCENT / 100.0));
                                    if (priceData.price <= orig_price)
                                    {
                                        // Cancel the old BUY Stop Limit
                                        binanceAPI.cancelOrder(ticker + "BTC", found.orderId, RECV_WINDOW).then ( (cancelRes) => 
                                        {
                                            if (cancelRes) 
                                            { 
                                                // Place a SELL side Stop Limit order at current price - 1%
                                                let stopLimit = priceData.price - ((priceData.price / 100.0) * STOP_LIMIT_PERCENT);
                                                let qty = (getBalanceBySymbol(ticker) / TEST_FACTOR).toFixed(3);
                                                
                                                binanceAPI.postOrder(ticker + "BTC", "SELL", "STOP_LOSS_LIMIT", "GTC", qty, stopLimit.toFixed(6), (stopLimit + 0.00001).toFixed(6), RECV_WINDOW).then( (limitRes) => 
                                                { 
                                                    if (limitRes)
                                                    {
                                                        // Put in a BUY order at Market price
                                                        let qty_btc = (getBalanceBySymbol("BTC") / TEST_FACTOR).toFixed(3);
                                                        binanceAPI.postOrder(ticker + "BTC", "BUY", "MARKET", "", qty_btc, 0, 0, RECV_WINDOW).then( (buyRes) => 
                                                        {
                                                            if (buyRes) { console.info(new Date(Date.now()).toISOString() + ": " + "Bought " + ticker + " @ " + priceData.price + ". Set Stop Loss @ " + stopLimit); }
                                                        });
                                                    }
                                                });
                                            }
                                        });
                                    }

                                    // Not in profit, cross occured between out Stop Limit and the price we sold at
                                    else
                                    {
                                        // Cancel the old BUY Stop Limit and wait for the next BEARISH cross
                                        binanceAPI.cancelOrder(ticker + "BTC", found.orderId, RECV_WINDOW).then ( (cancelRes) => 
                                        {
                                            if (cancelRes) { console.info(new Date(Date.now()).toISOString() + ": " + "Cross at a loss! Cancelled old limit order."); }
                                        });
                                    }
                                }); 
                            }
                        }
                    
                        // There are no open orders for this trading pair
                        else
                        {   
                            binanceAPI.getCurrentPrice(ticker + "BTC").then( (priceData) => 
                            {
                                // Place a SELL side Stop Limit order at current price - 1%
                                let stopLimit = priceData.price - ((priceData.price / 100.0) * STOP_LIMIT_PERCENT);
                                let qty = (getBalanceBySymbol(ticker) / TEST_FACTOR).toFixed(3);

                                binanceAPI.postOrder(ticker + "BTC", "SELL", "STOP_LOSS_LIMIT", "GTC", qty, stopLimit.toFixed(6), (stopLimit + 0.00001).toFixed(6), RECV_WINDOW).then( (limitRes) => 
                                { 
                                    if (limitRes)
                                    {
                                        // Put in a BUY order at Market price
                                        let qty_btc = (getBalanceBySymbol("BTC") / TEST_FACTOR).toFixed(3);
                                        binanceAPI.postOrder(ticker + "BTC", "BUY", "MARKET", "", qty_btc, 0, 0, RECV_WINDOW).then( (buyRes) => 
                                        {
                                            if (buyRes) { console.info(new Date(Date.now()).toISOString() + ": " + "Bought " + ticker + " @ " + priceData.price + ". Set Stop Loss @ " + stopLimit); }
                                            
                                            // If BUY order fails for some reason (no BTC?), cancel the previous limit order
                                            else
                                            {
                                                binanceAPI.cancelOrder(ticker + "BTC", JSON.parse(limitRes).orderId, RECV_WINDOW).then( (cancelRes) => 
                                                {
                                                    if (cancelRes) { console.info(new Date(Date.now()).toISOString() + ": " + ticker + " BUY failed! Cancelled Stop Limit order."); }
                                                });
                                            }
                                        });
                                    }
                                });
                            });
                        }  
                    });  
                }

                // BEARISH
                else if (crossType === "BEAR")
                {
                    console.info("\n" + new Date(Date.now()).toISOString() + ": " + ticker + " " + time_interval + " BEAR Cross");

                    // Check if we have any open Stop Limit orders...
                    binanceAPI.getOpenOrders(ticker + "BTC", RECV_WINDOW).then( (orders) => 
                    { 
                        if (orders.length > 0) { found = orders.find( (order) => { return order.symbol == ticker + "BTC" }); }
                        
                        // There is as an existing open order for this trading pair
                        if (found != "")
                        {
                            // We only care if it's a SELL-side Stop Limit... otherwise, we're just waiting for a BULLISH cross anyway
                            if (found.side == "SELL")
                            { 
                                binanceAPI.getCurrentPrice(ticker + "BTC").then( (priceData) => 
                                {
                                    // Check to see if our current price is GREATER THAN the price when we bought, to make sure we're in profit.
                                    let orig_price = found.price / (1.0 - (STOP_LIMIT_PERCENT / 100.0));
                                    if (priceData.price >= orig_price)
                                    {
                                        // Cancel the old SELL Stop Limit
                                        binanceAPI.cancelOrder(ticker + "BTC", found.orderId, RECV_WINDOW).then ( (cancelRes) => 
                                        {
                                            if (cancelRes) 
                                            { 
                                                // Place a BUY side Stop Limit order at current price + 1%
                                                let stopLimit = priceData.price + ((priceData.price / 100.0) * STOP_LIMIT_PERCENT);
                                                let qty_btc = (getBalanceBySymbol("BTC") / TEST_FACTOR).toFixed(3);

                                                binanceAPI.postOrder(ticker + "BTC", "BUY", "STOP_LOSS_LIMIT", "GTC", qty_btc, stopLimit.toFixed(6), (stopLimit - 0.00001).toFixed(6), RECV_WINDOW).then( (limitRes) => 
                                                { 
                                                    if (limitRes)
                                                    {
                                                        // Put in a SELL order for BTC at Market price
                                                        let qty = (getBalanceBySymbol(ticker) / TEST_FACTOR).toFixed(3);
                                                        binanceAPI.postOrder(ticker + "BTC", "SELL", "MARKET", "", qty, 0, 0, RECV_WINDOW).then( (sellRes) => 
                                                        {
                                                            if (sellRes) { console.info(new Date(Date.now()).toISOString() + ": " + "Sold " + ticker +  " @ " + priceData.price + ". Set Stop Loss @ " + stopLimit); }
                                                        });
                                                    }
                                                });
                                            }
                                        });
                                    }

                                    // Not in profit, cross occured between out Stop Limit and the price we sold at
                                    else
                                    {
                                        // Cancel the old SELL Stop Limit and wait for the next BULLISH cross
                                        binanceAPI.cancelOrder(ticker + "BTC", found.orderId, RECV_WINDOW).then ( (cancelRes) => 
                                        {
                                            if (cancelRes) { console.info(new Date(Date.now()).toISOString() + ": " + "Cross at a loss! Cancelled old limit order."); }
                                        });
                                    }
                                }); 
                            }
                        }
                    
                        // There are no open orders for this trading pair
                        else
                        {   
                            binanceAPI.getCurrentPrice(ticker + "BTC").then( (priceData) => 
                            {
                                // Place a BUY side Stop Limit order at current price + 1%
                                let stopLimit = priceData.price + ((priceData.price / 100.0) * STOP_LIMIT_PERCENT);
                                let qty_btc = (getBalanceBySymbol("BTC") / TEST_FACTOR).toFixed(3);

                                binanceAPI.postOrder(ticker + "BTC", "BUY", "STOP_LOSS_LIMIT", "GTC", qty_btc, stopLimit.toFixed(6), (stopLimit - 0.00001).toFixed(6), RECV_WINDOW).then( (limitRes) => 
                                { 
                                    if (limitRes)
                                    {
                                        // Put in a SELL order for BTC at Market price
                                        let qty = (getBalanceBySymbol(ticker) / TEST_FACTOR).toFixed(3);
                                        binanceAPI.postOrder(ticker + "BTC", "SELL", "MARKET", "", qty, 0, 0, RECV_WINDOW).then( (sellRes) => 
                                        {
                                            if (sellRes) { console.info(new Date(Date.now()).toISOString() + ": " + "Sold " + ticker + " @ " + priceData.price + ". Set Stop Loss @ " + stopLimit); }
                                            
                                            // If SELL order fails for some reason, cancel the previous limit order
                                            else
                                            {
                                                binanceAPI.cancelOrder(ticker + "BTC", JSON.parse(limitRes).orderId, RECV_WINDOW).then( (cancelRes) => 
                                                {
                                                    if (cancelRes) { console.info(new Date(Date.now()).toISOString() + ": " + ticker + " SELL failed! Cancelled Stop Limit order."); }
                                                });
                                            }
                                        });
                                    }
                                });
                            });
                        }  
                    });
                }
            }
        }

        else { console.error("ERROR: Request body did not contain the required parameters."); }
    });

});


// OTHER FUNCTIONS
function getBalanceBySymbol(symbol)
{
    return parseFloat(balances.find( (elem) => { return elem.asset == symbol; }).free); 
}
