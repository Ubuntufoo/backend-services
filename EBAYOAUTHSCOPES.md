# Authorization Code Grant Type

eBay OAuth Scope Name	Access Level / Short Description
[Metadata / Global]	
(default root scope)	View basic public eBay marketplace data.
commerce.catalog.readonly	Read-only access to the eBay catalog system.
	
[Inventory & Listings Management]	
sell.inventory	Full CRUD management of stock items, pricing, and offers.
sell.inventory.readonly	Read-only visibility into active stock and draft offers.
sell.inventory.mapping	Manage inventory mapping links via the Public API.
sell.item	Full modification and management of listed item attributes.
sell.item.draft	Create, delete, and modify listing drafts.
sell.stores	Manage full eBay Store configurations and layouts.
sell.stores.readonly	View public and backend eBay Store settings.
	
[Order Fulfillment & Finances]	
sell.fulfillment	Update order shipping tracking, print labels, and complete sales.
sell.fulfillment.readonly	View pending, historical, and unfulfilled order groups.
sell.finances	View transactions, balances, and execute processing refunds.
sell.payment.dispute	Full resolution management of open buyer payment cases.
commerce.shipping	View, calculate, and modify shipping services.
	
[Account Identity & Profile Data]	
commerce.identity.readonly	View foundational username and general account profiles.
commerce.identity.name.readonly	Read-only access to full first and last name variables.
commerce.identity.email.readonly	Extract the primary registered member email address.
commerce.identity.phone.readonly	Extract the verified primary contact telephone number.
commerce.identity.address.readonly	View verified primary residential/business addresses.
commerce.identity.status.readonly	Verify the real-time operational state of member accounts.
sell.account	Full configuration changes to shop profile structures.
sell.account.readonly	Read-only overview of platform account parameters.
	
[Buyer-Centric Features]	
buy.order.readonly	Internal pipeline validation for customer purchases.
buy.guest.order	Process checkouts for non-registered shoppers.
buy.shopping.cart	Programmatic interactions with internal shopping carts.
buy.offer.auction	Inject live bids and manage auction mechanics.
	
[Analytics, Marketing & Communications]	
sell.marketing	Create, modify, and terminate promotional ad campaigns.
sell.marketing.readonly	Monitor standard metric reports for promotions.
sell.analytics.readonly	Extract performance graphs and traffic intelligence.
sell.marketplace.insights.readonly	Read-only access to broader macro-market demand curves.
sell.reputation	Process feedback responses and manage ratings.
sell.reputation.readonly	View historical detailed seller performance feedback scores.
commerce.message	Read, draft, and dispatch client communications.
commerce.feedback	Core integrations with automated rating endpoints.
	
[Subscriptions & System Admin]	
commerce.notification.subscription	Create and modify real-time webhooks or event loops.
commerce.notification.subscription.readonly	Audit active outbound message endpoints.
commerce.vero	Verify ownership parameters via the Verified Rights Program.

eBay OAuth Scope Name	Access Level / Short Description
[Metadata & Public Data]	
(default root scope)	View basic public eBay marketplace data.
commerce.feedback.readonly	Read-only access to historical user feedback profiles.
	
[Product & Event Feeds]	
buy.item.feed	Access curated, time-delimited feeds of public eBay items.
buy.product.feed	Bulk download structural catalog and product detail feeds.
buy.item.bulk	Retrieve specific, targeted groups of public items in single requests.
buy.deal	View real-time promotional sales events and highlighted platform deals.
	
[Market Insights & Marketing]	
buy.marketplace.insights	View historical pricing and sales metrics for market trends.
buy.marketing	Retrieve product arrays for external promotional merchandising.
	
[Buyer Integration / Checkout]	
buy.guest.order	Initiate direct checkout flows for unauthenticated guest shoppers.
buy.proxy.guest.order	Execute secure proxy guest orders leveraging external PCI vaults.