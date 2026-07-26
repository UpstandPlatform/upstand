import { useChangePassword, useUpdateUser } from "@better-auth-ui/react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";

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

  return {
    updateUser: updateUserMutation.mutate,
    isUpdatingProfile: updateUserMutation.isPending,
    changePassword: changePasswordMutation.mutate,
    isChangingPassword: changePasswordMutation.isPending,
  };
}
