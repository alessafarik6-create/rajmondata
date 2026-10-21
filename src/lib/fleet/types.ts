import type { Timestamp } from "firebase-admin/firestore";

export type FleetTrackingProviderKind = "ECOFLEET" | "SATELITNI_SLEDOVANI";

export type FleetIntegrationStatus =
  | "not_connected"
  | "configured"
  | "connected"
  | "error"
  | "disabled";

export type FleetVehicleMovementStatus =
  | "moving"
  | "idle"
  | "parked"
  | "offline"
  | "unknown";

export type FleetVehicleDoc = {
  organizationId: string;
  name: string;
  licensePlate: string;
  vin?: string | null;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  notes?: string | null;
  vehicleType?: string | null;
  fuelType?: string | null;
  avgConsumptionL100?: number | null;
  odometerKm?: number | null;
  gpsDevicePhone?: string | null;
  stkExpiresAt?: string | null;
  insuranceExpiresAt?: string | null;
  serviceDueAt?: string | null;
  oilChangeDueAt?: string | null;
  tiresChangeDueAt?: string | null;
  customReminderAt?: string | null;
  customReminderLabel?: string | null;
  reminderDaysBefore?: number | null;
  /** false = archivované (skryté z běžného seznamu, historie zachována). */
  archived?: boolean;
  archivedAt?: Timestamp | null;
  /** Aktuální přiřazený řidič (employees.authUserId nebo uid). */
  currentDriverUserId?: string | null;
  currentDriverEmployeeId?: string | null;
  currentDriverName?: string | null;
  externalProvider?: FleetTrackingProviderKind | null;
  externalVehicleId?: string | null;
  externalDeviceId?: string | null;
  /** Poslední známý stav z providera (cache pro UI, ne historie bodů). */
  lastMovementStatus?: FleetVehicleMovementStatus | null;
  lastSpeedKmh?: number | null;
  /** Směr jízdy ve stupních (0 = sever), z poslední GPS polohy. */
  lastHeadingDeg?: number | null;
  lastLatitude?: number | null;
  lastLongitude?: number | null;
  lastLocationLabel?: string | null;
  lastPositionAt?: Timestamp | null;
  todayDistanceKm?: number | null;
  ignitionOn?: boolean | null;
  /** Poslední telemetrie z API v2 (switches, sources). */
  lastTelemetry?: Record<string, unknown> | null;
  active?: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export type FleetDriverAssignmentDoc = {
  organizationId: string;
  vehicleId: string;
  driverUserId: string;
  driverEmployeeId?: string | null;
  driverName?: string | null;
  assignedFrom: Timestamp;
  assignedTo?: Timestamp | null;
  note?: string | null;
  createdByUserId?: string | null;
  createdAt?: Timestamp;
};

export type FleetTripDoc = {
  organizationId: string;
  vehicleId: string;
  driverUserId?: string | null;
  driverName?: string | null;
  jobId?: string | null;
  jobLabel?: string | null;
  tripType?: "business" | "private" | null;
  purpose?: string | null;
  note?: string | null;
  odometerStartKm?: number | null;
  odometerEndKm?: number | null;
  driverConfirmed?: boolean | null;
  startedAt: Timestamp;
  endedAt?: Timestamp | null;
  startAddress?: string | null;
  endAddress?: string | null;
  startLat?: number | null;
  startLng?: number | null;
  endLat?: number | null;
  endLng?: number | null;
  distanceKm?: number | null;
  durationMinutes?: number | null;
  idleMinutes?: number | null;
  avgSpeedKmh?: number | null;
  maxSpeedKmh?: number | null;
  externalProvider?: FleetTrackingProviderKind | null;
  externalTripId?: string | null;
  /** Route points se načítají z providera nebo volitelně fleet_trip_points — bez masivního ingestu. */
  routeFetchedAt?: Timestamp | null;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export type FleetTripPointDoc = {
  organizationId: string;
  tripId: string;
  vehicleId: string;
  recordedAt: Timestamp;
  lat: number;
  lng: number;
  speedKmh?: number | null;
  heading?: number | null;
};

export type FleetStopDoc = {
  organizationId: string;
  tripId: string;
  vehicleId: string;
  startedAt: Timestamp;
  endedAt?: Timestamp | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
};

export type FleetPositionSnapshot = {
  vehicleId: string;
  lat: number;
  lng: number;
  speedKmh?: number | null;
  movementStatus: FleetVehicleMovementStatus;
  recordedAt: string;
  locationLabel?: string | null;
  ignitionOn?: boolean | null;
  headingDeg?: number | null;
};

export type FleetIntegrationDoc = {
  organizationId: string;
  provider: FleetTrackingProviderKind;
  status: FleetIntegrationStatus;
  apiBaseUrl?: string | null;
  oauthClientId?: string | null;
  connectedAt?: Timestamp | null;
  connectedByUserId?: string | null;
  lastSyncAt?: Timestamp | null;
  /** Poslední live refresh poloh pro mapu (bez celého importu katalogu). */
  lastPositionSyncAt?: Timestamp | null;
  lastSyncVehicleCount?: number | null;
  lastSyncImportedCount?: number | null;
  lastSyncStoredCount?: number | null;
  lastSyncGpsCount?: number | null;
  lastSyncSummary?: string | null;
  lastSyncError?: string | null;
  lastTestAt?: Timestamp | null;
  lastError?: string | null;
  configuredByUserId?: string | null;
  updatedAt?: Timestamp;
};

export const FLEET_VEHICLES_SUBCOLLECTION = "fleet_vehicles";
export const FLEET_DRIVER_ASSIGNMENTS_SUBCOLLECTION = "fleet_driver_assignments";
export const FLEET_TRIPS_SUBCOLLECTION = "fleet_trips";
export const FLEET_TRIP_POINTS_SUBCOLLECTION = "fleet_trip_points";
export const FLEET_STOPS_SUBCOLLECTION = "fleet_stops";
export const FLEET_INTEGRATION_DOC_ID = "fleet_integration";
export const FLEET_INTEGRATION_CREDENTIALS_DOC = "credentials";
