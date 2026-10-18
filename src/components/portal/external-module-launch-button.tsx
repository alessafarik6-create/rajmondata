"use client";

import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useUser } from "@/firebase";
import { useToast } from "@/hooks/use-toast";
import type { PlatformModuleCode } from "@/lib/platform-config";
import { useExternalModuleLaunch } from "@/hooks/use-external-module-launch";

type Props = {
  moduleCode: PlatformModuleCode;
  label?: string;
  className?: string;
  openInNewTab?: boolean;
  onSuccess?: () => void;
  onError?: (message: string) => void;
  buttonId?: string;
};

export function ExternalModuleLaunchButton(props: Props) {
  const { moduleCode, label, className, openInNewTab = true, onSuccess, onError, buttonId } = props;
  const { user } = useUser();
  const { toast } = useToast();
  const { launch, isLoading } = useExternalModuleLaunch(moduleCode);

  async function onLaunchClick() {
    const result = await launch(user, { openInNewTab });
    if (result.ok) onSuccess?.();
    else if (result.error) {
      onError?.(result.error);
      if (!onError) {
        toast({ variant: "destructive", title: "RAJMONDATA EDITOR", description: result.error });
      }
    }
  }

  return (
    <Button
      id={buttonId}
      type="button"
      className={className ?? "bg-orange-500 hover:bg-orange-600 text-black"}
      disabled={isLoading || !user}
      onClick={() => void onLaunchClick()}
    >
      {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : label ?? "Spustit editor"}
    </Button>
  );
}
