# Trading View Binance Bot
WIP project. Messy and untested atm, just threw this together in a day. Handles POST requests from [TradingView](https://www.tradingview.com/) alert webhooks and uses them to trigger [Binance API](https://github.com/binance-exchange/binance-official-api-docs/blob/master/rest-api.md) calls to make buy/sell orders (and set stop losses) based on any simple "crossing" strategy on short timeframes (i.e. when EMA 10 crosses up EMA 20, it's a "bullish" cross, so we BUY and wait for a "bearish" cross).

Prerequisites
-------------
* Binance account and API keys, stored in api-config.json.
* Paid TradingView account is required to use webhook alerts. 
* Alerts need to be set up to send JSON messages with the following key: "time" (time interval, e.g. "5m"), "base" (1st currency in trading pair), "quote" (2nd currency in trading pair), and "crossType" ("BULL" or "BEAR", indicating  which type of orders to trigger on Binance).
* REST Server needs to be accessible by TradingView's requests. For testing, localhost with [ngrok](https://ngrok.com/) or [PageKite](https://pagekite.net/) works fine. Probably a good idea to only allow [TradingView's IPs](https://www.tradingview.com/support/solutions/43000529348-about-webhooks/) in any case.

To-Do
------
* Clean up code and make it less redundant.
* Thoroughly test functionality/debug by running program for a few days and checking out console logs and Binance order history.
* <del>Abstract the "BTC" stuff out and replace it with another value from the TradingView alerts so this works with any trading pair.</del>
* <del>Take out references to "EMA"s, since this isn't actually limited to an EMA crossing strategy.</del>
* Maybe adjust the stop loss percentage based on the daily trend or something.
