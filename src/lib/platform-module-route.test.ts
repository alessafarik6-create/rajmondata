import { resolvePlatformModuleFromRouteParam } from "@/lib/platform-module-route";

console.assert(
  resolvePlatformModuleFromRouteParam("rajmondata-editor") === "rajmondata_editor",
  "externalId slug"
);
console.assert(
  resolvePlatformModuleFromRouteParam("rajmondata_editor") === "rajmondata_editor",
  "canonical code"
);
console.log("[platform-module-route.test] OK");
