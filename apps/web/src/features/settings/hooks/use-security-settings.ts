import { useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";

export function useSecuritySettings(onVerifySuccess?: () => void) {
  const [loading, setLoading] = useState(false);
  const [totpURI, setTotpURI] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [showBackupCodes, setShowBackupCodes] = useState(false);

  const handleEnable = async (password: string) => {
    setLoading(true);
    try {
      const { data, error } = await authClient.twoFactor.enable({ password });
      if (error) {
        toast.error(error.message || "Failed to start 2FA setup");
      } else if (data) {
        setTotpURI(data.totpURI);
        setBackupCodes(data.backupCodes);
        return true;
      }
    } catch {
      toast.error("An error occurred.");
    } finally {
      setLoading(false);
    }
    return false;
  };

  const handleConfirm = async (code: string) => {
    setLoading(true);
    try {
      const { error } = await authClient.twoFactor.verifyTotp({
        code: code.trim(),
      });
      if (error) {
        toast.error(error.message || "Invalid code");
      } else {
        toast.success("2FA enabled successfully!");
        setTotpURI(null);
        setShowBackupCodes(true);
        if (onVerifySuccess) {
          onVerifySuccess();
        }
      }
    } catch {
      toast.error("Failed to verify code.");
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async (password: string) => {
    setLoading(true);
    try {
      const { error } = await authClient.twoFactor.disable({ password });
      if (error) {
        toast.error(error.message || "Failed to disable 2FA");
      } else {
        toast.success("2FA disabled.");
        setShowBackupCodes(false);
      }
    } catch {
      toast.error("An error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateBackupCodes = async () => {
    setLoading(true);
    try {
      const { data, error } = await authClient.twoFactor.generateBackupCodes(
        {},
      );
      if (error) {
        toast.error(error.message || "Failed to generate recovery codes");
      } else if (data) {
        setBackupCodes(data.backupCodes);
        setShowBackupCodes(true);
        toast.success("New recovery codes generated");
      }
    } catch {
      toast.error("Failed to generate recovery codes");
    } finally {
      setLoading(false);
    }
  };

  const cancelSetup = () => {
    setTotpURI(null);
  };

  return {
    loading,
    totpURI,
    backupCodes,
    showBackupCodes,
    setShowBackupCodes,
    handleEnable,
    handleConfirm,
    handleDisable,
    handleRegenerateBackupCodes,
    cancelSetup,
  };
}
