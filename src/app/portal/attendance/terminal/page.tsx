"use client";

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { AttendanceTerminal } from "@/components/attendance/AttendanceTerminal";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

type BoundaryProps = { children: ReactNode };
type BoundaryState = { error: Error | null };

class AttendanceTerminalErrorBoundary extends Component<
  BoundaryProps,
  BoundaryState
> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      "[AttendanceTerminal] render error:",
      error.message,
      info.componentStack
    );
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 max-w-lg mx-auto">
          <Alert variant="destructive" className="w-full">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Terminál se nepodařilo zobrazit</AlertTitle>
            <AlertDescription className="break-words">
              {this.state.error.message}
            </AlertDescription>
          </Alert>
          <Button
            type="button"
            variant="outline"
            className="mt-6"
            onClick={() => this.setState({ error: null })}
          >
            Zkusit znovu
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function PortalAttendanceTerminalPage() {
  return (
    <AttendanceTerminalErrorBoundary>
      <AttendanceTerminal />
    </AttendanceTerminalErrorBoundary>
  );
}
