# Trading View Binance Bot
Abandoned when I realized trading is a hopeless endeavor! Logic all works; good luck with the API however, it was quite finicky when I was using it.

Handles POST requests from [TradingView](https://www.tradingview.com/) alert webhooks and uses them to trigger [Binance API](https://github.com/binance-exchange/binance-official-api-docs/blob/master/rest-api.md) calls to make buy/sell orders (and set stop losses) based on any simple "crossing" strategy on short timeframes (i.e. when EMA 10 crosses up EMA 20, it's a "bullish" cross, so we BUY and wait for a "bearish" cross).


Prerequisites
-------------
* Binance account and API keys, stored in api-config.json.
* Paid TradingView account is required to use webhook alerts. 
* Alerts need to be set up to send JSON messages with the following keys: "time" (time interval, e.g. "5m"), "base" (1st currency in trading pair), "quote" (2nd currency in trading pair), and "crossType" ("BULL" or "BEAR", indicating  which type of orders to trigger on Binance).
* REST Server needs to be accessible by TradingView's requests. For testing, localhost with [ngrok](https://ngrok.com/) or [PageKite](https://pagekite.net/) works fine. Probably a good idea to only allow [TradingView's IPs](https://www.tradingview.com/support/solutions/43000529348-about-webhooks/) in any case.
