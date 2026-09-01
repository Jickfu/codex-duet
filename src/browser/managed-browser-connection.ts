import { ExistingBrowserConnection } from './existing-browser-connection.js';

/** A managed browser is attached over its loopback CDP endpoint; close means detach. */
export class ManagedBrowserConnection extends ExistingBrowserConnection {}
export class BundledBrowserConnection extends ManagedBrowserConnection {}
