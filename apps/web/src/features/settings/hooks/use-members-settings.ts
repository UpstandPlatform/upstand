import {
  useCancelInvitation,
  useListOrganizationInvitations,
} from "@better-auth-ui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { authUiClient } from "@/lib/auth-client";
import { getUserFacingError } from "@/lib/error-message";
import { trpc } from "@/utils/trpc";

export function useMembersSettings(organizationId: string) {
  const queryClient = useQueryClient();

  const membersQuery = useQuery({
    ...trpc.member.list.queryOptions({ organizationId }),
    enabled: Boolean(organizationId),
  });

  const channelsQuery = useQuery({
    ...trpc.notification.list.queryOptions({ organizationId }),
    enabled: Boolean(organizationId),
  });

  const { data: invites, refetch: refetchInvites } =
    useListOrganizationInvitations(authUiClient, {
      query: { organizationId },
    });

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: trpc.member.list.queryKey({ organizationId }),
    });
  };

  const createMutation = useMutation({
    ...trpc.member.create.mutationOptions(),
    onSuccess: () => {
      toast.success("Member created");
      refresh();
    },
    onError: (error) =>
      toast.error(getUserFacingError(error, "Unable to create member")),
  });

  const inviteMutation = useMutation({
    ...trpc.member.invite.mutationOptions(),
    onSuccess: () => {
      toast.success("Invitation sent");
      void refetchInvites();
    },
    onError: (error) =>
      toast.error(getUserFacingError(error, "Unable to send invitation")),
  });

  const updateMutation = useMutation({
    ...trpc.member.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Member permissions saved");
      refresh();
    },
    onError: (error) =>
      toast.error(getUserFacingError(error, "Unable to update member")),
  });

  const removeMutation = useMutation({
    ...trpc.member.remove.mutationOptions(),
    onSuccess: () => {
      toast.success("Member removed");
      refresh();
    },
    onError: (error) =>
      toast.error(getUserFacingError(error, "Unable to remove member")),
  });

  const { mutate: cancelInvitation } = useCancelInvitation(authUiClient, {
    onSuccess: () => {
      toast.success("Invitation cancelled");
      void refetchInvites();
    },
    onError: (error) => toast.error(error.message),
  });

  return {
    members: membersQuery.data?.members ?? [],
    isLoadingMembers: membersQuery.isPending,
    notificationChannels: channelsQuery.data ?? [],
    invites: invites ?? [],
    inviteMember: inviteMutation.mutate,
    isInviting: inviteMutation.isPending,
    createMember: createMutation.mutate,
    isCreating: createMutation.isPending,
    updateMember: updateMutation.mutate,
    removeMember: removeMutation.mutate,
    cancelInvitation,
  };
}
