import { useChangePassword, useUpdateUser } from "@better-auth-ui/react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { getServerApiUrl } from "@/lib/server-url";

export function useProfileSettings(onPasswordSuccess?: () => void) {
  const updateUserMutation = useUpdateUser(authClient, {
    onSuccess: () => {
      toast.success("Profile updated");
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update profile");
    },
  });

  const changePasswordMutation = useChangePassword(authClient, {
    onSuccess: () => {
      toast.success("Password updated");
      if (onPasswordSuccess) {
        onPasswordSuccess();
      }
    },
    onError: (err) => {
      toast.error(err.message || "Failed to update password");
    },
  });

  const setPassword = async (newPassword: string): Promise<void> => {
    try {
      const response = await fetch(
        getServerApiUrl("/api/auth/security/set-password"),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newPassword }),
        },
      );
      const payload = (await response.json().catch(() => undefined)) as
        | { error?: string }
        | undefined;
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to set password");
      }
      toast.success("Password created");
      onPasswordSuccess?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to set password",
      );
    }
  };

  return {
    updateUser: updateUserMutation.mutate,
    isUpdatingProfile: updateUserMutation.isPending,
    changePassword: changePasswordMutation.mutate,
    setPassword,
    isChangingPassword: changePasswordMutation.isPending,
  };
}
