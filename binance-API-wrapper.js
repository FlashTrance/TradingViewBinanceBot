// IMPORTS
const axios = require("axios");
const crypto = require("crypto");
const XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;

const config = require("./api-config.json");

// GLOBAL VARIABLES
const BASE_URL = "https://api.binance.com/api/v3";
const API_KEY = config.BINANCE_API_KEY;
const API_SECRET = config.BINANCE_API_SECRET;


// API FUNCTIONS //

//////////////
// UNSIGNED //
//////////////

// GET CURRENT PRICE
const getCurrentPrice = function getCurrentPrice(symbol)
{
    // @ params
    // symbol: Trading pair

    // Wrap GET in a Promise so we can respond to the resolved value
    return new Promise( (resolve, reject) => 
    {
        // Get current price for provided ticker
        axios.get(BASE_URL + "/ticker/price?symbol=" + symbol).then( (res, err) => 
        {
            if (err) { reject(err); }
            else 
            { 
                resolve(res.data)
            }
        });
    }).catch( (err) => { console.error(err); });
}


////////////
// SIGNED //
////////////

// NOTE --- The following parameters are REQUIRED for authentication when sending a signed request...
// timestamp: The current Binance server time in ms (Date.now() doesn't always work).
// signature: A signature created by hashing the query string with the API secret key. Use "getSignature()" function.

// PLACE ACTIVE ORDER
const postOrder = function postOrder(symbol, side, type, timeInForce, quantity, price, stopPrice, recvWindow)
{
    // @ params
    // symbol: Trading symbol
    // side: "BUY" or "SELL"
    // type: "STOP_LOSS_LIMIT" (for a BUY) or "TAKE_PROFIT_LIMIT" (for a SELL) or "MARKET"
    // timeInForce: "GTC", "IOC", "FOK"
    // quantity: Number of contracts (quantity in USD)
    // price: Order price
    // stopPrice: Used with STOP_LOSS_LIMIT order
    // recvWindow: How long to wait for a response from the server

    // Wrap POST in a Promise so we can respond to the resolved value
    return new Promise( (resolve, reject) => 
    {
        // Get Binance server time
        axios.get(BASE_URL + "/time").then( (res, err) => 
        {
            if (err) { reject(err); }
            else 
            { 
                // Query string parameters common across order types 
                let params = "symbol=" + symbol + "&side=" + side + "&type=" + type + "&recvWindow=" + recvWindow + "&timestamp=" + res.data["serverTime"];
                
                // Adjust query string based on order type (MARKET vs STOP_LOSS_LIMIT)
                if (type == "MARKET")
                {
                    if (side == "SELL")     { params += "&quantity=" + quantity; }
                    else if (side == "BUY") { params += "&quoteOrderQty=" + quantity; }
                }
                else
                {
                    params += "&timeInForce=" + timeInForce + "&quantity=" + quantity + "&price="  + price + "&stopPrice=" + stopPrice;
                }
                let signature = getSignature(params, API_SECRET); 
                let url = BASE_URL + "/order" + "?" + params + "&signature=" + signature;

                // Setup request
                let req = new XMLHttpRequest();
                req.open("POST", url, true);
                req.setRequestHeader("X-MBX-APIKEY", API_KEY);

                // Request handlers
                req.onload = () =>
                {
                    let data = req.responseText;
                    resolve(data);
                }
                req.onreadystatechange = () =>
                {
                    if (req.status != 200 && req.status != 0) 
                    { 
                        reject("ERROR (postOrder): Request to Binance API failed! Response: " + req.responseText); 
                    }
                }

                // Send POST request
                req.send();
            }
        });
    }).catch( (err) => { console.error(err) }); // Log "err" here for debugging
};


// CANCEL ACTIVE ORDER
const cancelOrder = function cancelOrder(symbol, orderId, recvWindow)
{
    // @ params
    // symbol: Trading symbol
    // orderId: Id of order to cancel 
    // recvWindow: How long to wait for a response from the server

    // Wrap DELETE in a Promise so we can respond to the resolved value
    return new Promise( (resolve, reject) => 
    {
        // Get Binance server time
        axios.get(BASE_URL + "/time").then( (res, err) => 
        {
            if (err) { reject(err); }
            else 
            { 
                // Setup query string
                params = "symbol=" + symbol + "&orderId=" + orderId + "&recvWindow=" + recvWindow + "&timestamp=" + res.data["serverTime"];
                let signature = getSignature(params, API_SECRET);
                let url = BASE_URL + "/order" + "?" + params + "&signature=" + signature;

                // Setup request
                let req = new XMLHttpRequest();
                req.open("DELETE", url, true);
                req.setRequestHeader("X-MBX-APIKEY", API_KEY);

                // Request handlers
                req.onload = () =>
                {
                    let data = req.responseText;
                    resolve(data);
                }
                req.onreadystatechange = () =>
                {
                    if (req.status != 200 && req.status != 0) 
                    { 
                        reject("ERROR (cancelOrder): Request to Binance API failed! Response: " + req.responseText); 
                    }
                }

                // Send DELETE request
                req.send();
            }
        });
    }).catch( (err) => { console.error(err); });
};


// GET USER ACCOUNT INFO
const getAccountInfo = function getAccountInfo(recvWindow)
{
    // @ params
    // recvWindow: How long to wait for a response from the server

    // Wrap GET in a Promise so we can respond to the resolved value
    return new Promise( (resolve, reject) => 
    {
        // Get Binance server time
        axios.get(BASE_URL + "/time").then( (res, err) => 
        {
            if (err) { reject(err); }
            else 
            { 
                // Setup query string
                let params = "recvWindow=" + recvWindow + "&timestamp=" + res.data["serverTime"];
                let signature = getSignature(params, API_SECRET);  
                let url = BASE_URL + "/account" + "?" + params + "&signature=" + signature;

                // Setup request
                let req = new XMLHttpRequest();
                req.open("GET", url, true);
                req.setRequestHeader("X-MBX-APIKEY", API_KEY);

                // Request handlers
                req.onload = () =>
                {
                    let data = JSON.parse(req.responseText);
                    resolve(data);
                }
                req.onreadystatechange = () =>
                {
                    if (req.status != 200 && req.status != 0) 
                    { 
                        reject("ERROR (getAccountInfo): Request to Binance API failed! Response: " + req.responseText); 
                    }
                }

                // Send GET request
                req.send();
            }
        });
    }).catch( (err) => { console.error(err); });
}


// GET OPEN ORDERS
const getOpenOrders = function getOpenOrders(symbol, recvWindow)
{
    // @ params
    // symbol: The trading pairs to return (e.g. "ETHBTC")
    // recvWindow: How long to wait for a response from the server

    // Wrap GET in a Promise so we can respond to the resolved value
    return new Promise( (resolve, reject) => 
    {
        // Get Binance server time
        axios.get(BASE_URL + "/time").then( (res, err) => 
        {
            if (err) { reject(err); }
            else 
            { 
                // Setup query string
                let params = "symbol=" + symbol + "&recvWindow=" + recvWindow + "&timestamp=" + res.data["serverTime"];
                let signature = getSignature(params, API_SECRET);
                let url = BASE_URL + "/openOrders" + "?" + params + "&signature=" + signature;

                // Setup request
                let req = new XMLHttpRequest();
                req.open("GET", url, true);
                req.setRequestHeader("X-MBX-APIKEY", API_KEY);

                // Request handlers
                req.onload = () =>
                {
                    let data = JSON.parse(req.responseText);
                    resolve(data);
                }
                req.onreadystatechange = () =>
                {
                    if (req.status != 200 && req.status != 0) 
                    { 
                        reject("ERROR (getOpenOrders): Request to Binance API failed! Response: " + req.responseText); 
                    }
                }

                // Send GET request
                req.send();
            }
        });
    }).catch( (err) => { console.error(err); });
}



/////////////
// UTILITY //
/////////////

// GET SIGNATURE - Generates a signature using request params for use in signed API calls
function getSignature(parameters, secret) 
{
	return crypto.createHmac('sha256', secret).update(parameters).digest('hex');
}


// EXPORT FUNCTIONS
module.exports = { getCurrentPrice, postOrder, cancelOrder, getAccountInfo, getOpenOrders, getSignature };
