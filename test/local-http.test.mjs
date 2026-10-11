import assert from "node:assert/strict";
import test from "node:test";
import { corsHeaders, isLocalHost } from "../src/local-http.mjs";

test("the status service only answers requests addressed to this Mac", () => {
  assert.equal(isLocalHost("127.0.0.1:50702"), true);
  assert.equal(isLocalHost("localhost:50702"), true);
  assert.equal(isLocalHost("evil.example:50702"), false, "DNS-rebinding hostname");
  assert.equal(isLocalHost("127.0.0.1.evil.example"), false);
  assert.equal(isLocalHost(undefined), false);
});

test("CORS is granted to local pages only", () => {
  assert.equal(corsHeaders("http://127.0.0.1:50703")["access-control-allow-origin"], "http://127.0.0.1:50703");
  assert.equal(corsHeaders("https://evil.example")["access-control-allow-origin"], undefined);
  assert.equal(corsHeaders(undefined)["access-control-allow-origin"], undefined);
});
