"use client";

import { useParams } from "next/navigation";
import { FleetVehicleDetailPage } from "@/components/fleet/fleet-vehicle-detail-page";

export default function PortalFleetVehicleDetailPage() {
  const params = useParams();
  const vehicleId = String(params?.vehicleId ?? "");
  return <FleetVehicleDetailPage vehicleId={vehicleId} />;
}
