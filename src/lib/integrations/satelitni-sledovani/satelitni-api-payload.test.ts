import { extractListItems, normalizeSatelitniRecord, unwrapSatelitniResource } from "@/lib/integrations/satelitni-sledovani/api-payload";
import { mapSatelitniVehicle, pickSatelitniExternalVehicleId } from "@/lib/integrations/satelitni-sledovani/mappers";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function testExtractVehiclesKey() {
  const payload = {
    vehicles: [{ id: 12, label: "kovokan s.r.o.", device_id: 43081 }],
    meta: { has_more: false },
  };
  const list = extractListItems<Record<string, unknown>>(payload);
  assert(list.length === 1, "vehicles key");
  assert(String(list[0].label) === "kovokan s.r.o.", "label");
}

function testJsonApiAttributes() {
  const payload = {
    data: [
      {
        id: "99",
        type: "vehicle",
        attributes: { label: "Test", car_sign: "1AB2345", device_id: 43081 },
      },
    ],
  };
  const list = extractListItems<Record<string, unknown>>(payload);
  const mapped = mapSatelitniVehicle(list[0]);
  assert(mapped.externalVehicleId === "99", "json api id");
  assert(mapped.name.includes("Test"), "json api name");
  assert(mapped.externalDeviceId === "43081", "device id");
}

function testDeviceIdFallback() {
  const v = { device_id: 43081, label: "kovokan s.r.o." };
  assert(pickSatelitniExternalVehicleId(v) === "43081", "device id as external");
  const mapped = mapSatelitniVehicle(v);
  assert(mapped.externalVehicleId === "43081", "mapped device");
}

function testUnwrapPosition() {
  const raw = {
    data: { latitude: 49.5, longitude: 15.2, speed: 40, received_at: "2026-01-01T12:00:00Z" },
  };
  const flat = unwrapSatelitniResource<Record<string, unknown>>(raw);
  assert(flat.latitude === 49.5, "unwrap lat");
}

function testNormalizeRecord() {
  const n = normalizeSatelitniRecord({ id: 1, attributes: { label: "A" } });
  assert(n.id === 1 && n.label === "A", "normalize");
}

testExtractVehiclesKey();
testJsonApiAttributes();
testDeviceIdFallback();
testUnwrapPosition();
testNormalizeRecord();

console.log("satelitni-api-payload.test.ts OK");
