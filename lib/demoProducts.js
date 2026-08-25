const FAKESTORE_URL = "https://fakestoreapi.com/products/category/electronics";
const FETCH_TIMEOUT_MS = 4000;
const MAX_PRODUCTS = 6;

// FakeStoreAPI prices are USD. Relabeling the raw number as ₹ instead of
// applying a real FX rate is deliberate, not laziness: the checkout demo's
// /api/checkout/create-order caps orders at ₹5,000 (test-mode sanity cap).
// This category's 6 real items range $64-$999.99 - at a realistic ~83
// INR/USD rate, the $999.99 monitor alone would be ~₹83,000 and instantly
// break checkout. Relabeled as ₹, the same 6 items sum to under ₹2,000
// even with one of each in the cart, which stays safely within the cap at
// realistic demo quantities.
export const USD_TO_INR_DISPLAY = 1;

// Same 6 real electronics products (id, title, price, image), captured as
// a static fallback so a slow/unavailable FakeStoreAPI never breaks the
// demo - this matters most right when it's least convenient to debug, e.g.
// mid pitch-recording.
export const FALLBACK_PRODUCTS = [
  {
    id: 9,
    title: "WD 2TB Elements Portable External Hard Drive - USB 3.0",
    price: 64,
    image: "https://fakestoreapi.com/img/61IBBVJvSDL._AC_SY879_t.png",
  },
  {
    id: 10,
    title: "SanDisk SSD PLUS 1TB Internal SSD - SATA III 6 Gb/s",
    price: 109,
    image: "https://fakestoreapi.com/img/61U7T1koQqL._AC_SX679_t.png",
  },
  {
    id: 11,
    title: "Silicon Power 256GB SSD 3D NAND A55 SLC Cache Performance Boost",
    price: 109,
    image: "https://fakestoreapi.com/img/71kWymZ+c+L._AC_SX679_t.png",
  },
  {
    id: 12,
    title: "WD 4TB Gaming Drive Works with Playstation 4",
    price: 114,
    image: "https://fakestoreapi.com/img/61mtL65D4cL._AC_SX679_t.png",
  },
  {
    id: 13,
    title: "Acer SB220Q bi 21.5 inches Full HD IPS Monitor",
    price: 599,
    image: "https://fakestoreapi.com/img/81QpkIctqPL._AC_SX679_t.png",
  },
  {
    id: 14,
    title: "Samsung 49-Inch CHG90 144Hz Curved Gaming Monitor",
    price: 999.99,
    image: "https://fakestoreapi.com/img/81Zt42ioCgL._AC_SX679_t.png",
  },
];

/**
 * Fetches the electronics category from FakeStoreAPI, bounded to
 * MAX_PRODUCTS and a hard timeout so a slow third-party API never hangs
 * the page. Falls back to FALLBACK_PRODUCTS (same real data, captured
 * statically) on any failure - timeout, network error, non-200, or a
 * malformed response - rather than letting the demo break.
 */
export async function fetchDemoProducts() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(FAKESTORE_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`FakeStoreAPI returned ${res.status}`);

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("FakeStoreAPI returned an empty/malformed product list");
    }

    return data.slice(0, MAX_PRODUCTS).map((p) => ({
      id: p.id,
      title: p.title,
      price: p.price,
      image: p.image,
    }));
  } catch (err) {
    console.warn(`FakeStoreAPI unavailable, using fallback product list: ${err.message || err}`);
    return FALLBACK_PRODUCTS;
  } finally {
    clearTimeout(timeoutId);
  }
}
