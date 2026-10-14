import assert from "node:assert/strict";
import {
  productionEndReasonForTariffPause,
  productionQrDisplayStatusForTariff,
  productionQrStatusLabelCs,
} from "./production-qr-session-types";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`fail ${name}`, e);
    process.exitCode = 1;
  }
}

test("oběd → paused_lunch", () => {
  assert.equal(productionQrDisplayStatusForTariff({ name: "Oběd" }), "paused_lunch");
  assert.equal(productionEndReasonForTariffPause({ name: "Oběd" }), "attendance_lunch");
});

test("cesta → paused_travel", () => {
  assert.equal(productionQrDisplayStatusForTariff({ name: "Cesta" }), "paused_travel");
  assert.equal(productionEndReasonForTariffPause({ name: "Cesta" }), "attendance_break");
});

test("jiný tarif", () => {
  assert.equal(productionQrDisplayStatusForTariff({ name: "Školení" }), "paused_tariff");
  assert.ok(productionQrStatusLabelCs("paused_tariff").includes("tarif"));
});
