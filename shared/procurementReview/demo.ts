/**
 * The no-login demo workspace ships a published snapshot of its own, built by
 * scripts/build-procurement-review-demo.ts into public/demo/procurement-review/
 * with exactly the layout Zoer publishes to SharePoint (contract §3). The demo
 * reads those static files instead of the hosted blob route.
 */

/** The folder the demo workspace is preset to, shown wherever the page names its folder. */
export const DEMO_PROCUREMENT_REVIEW_FOLDER = "Zoer/bc-bid-monitor/riverside-community-society";

/** Where the demo snapshot is served from, relative to the app's base URL. */
export const DEMO_PROCUREMENT_REVIEW_DIRECTORY = "demo/procurement-review/";
