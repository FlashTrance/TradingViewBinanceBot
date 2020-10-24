# Trading View Binance Bot
WIP project. Messy and untested atm, just threw this together in a day. Handles POST requests from [TradingView](https://www.tradingview.com/) alert webhooks and uses them to trigger [Binance API](https://github.com/binance-exchange/binance-official-api-docs/blob/master/rest-api.md) calls to make buy/sell orders (and set stop losses) based on a simple EMA crossing strategy on short timeframes (i.e. when EMA 10 crosses up EMA 20, it's a "bullish" cross).

Though, I guess technically it would work on any strategy where all one wants is to trigger buy/sell orders based on a couple of TradingView alerts ("bullish" or "bearish")...

Prerequisites
-------------
* Binance account and API keys, stored in api-config.json.
* Paid TradingView account is required to use webhook alerts. 
* Alerts need to be set up to send JSON messages with "time" (the time interval), "currency" (the crypto symbol being traded against BTC), and "crossType" ("BULL" or "BEAR") keys to indicate which type of orders to trigger on Binance.
* REST Server needs to be accessible by TradingView's requests. For testing, localhost with [ngrok](https://ngrok.com/) or [PageKite](https://pagekite.net/) works fine. Probably a good idea to only allow [TradingView's IPs](https://www.tradingview.com/support/solutions/43000529348-about-webhooks/) in any case.

To-Do
------
* Clean up code and make it less redundant.
* Thoroughly test functionality/debug by running program for a few days and checking out console logs and Binance order history.
* Abstract the "BTC" stuff out and replace it with another value from the TradingView alerts so this works with any trading pair.
* Take out references to "EMA"s, since this isn't actually limited to an EMA crossing strategy.
* Maybe adjust the stop loss percentage based on the daily trend or something.
