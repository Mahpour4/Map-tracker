/*
 * User Configuration — Edit this file to manage viewer access
 *
 * To add a user:
 *   1. Pick a PIN for them
 *   2. Open the viewer in a browser, open DevTools console (F12)
 *   3. Run:  await hashPin("1234")    (replace 1234 with their PIN)
 *   4. Copy the hash string and add a new entry below
 *
 * Pages: "orders", "inventory", "schedule", "visits", "map"
 */

const USERS = [
  {
    name: "Owner",
    // PIN: 1234 — change this before deploying!
    pinHash: "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4",
    pages: ["orders", "inventory", "schedule", "visits", "map"]
  },
  {
    name: "Secretary",
    // PIN: 5678 — change this before deploying!
    pinHash: "f8638b979b2f4f793ddb6dbd197e0ee25a7a6ea32b0ae22f5e3c5d119d839e75",
    pages: ["orders", "schedule"]
  }
];
