"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { getUpGalTargetDefinition } from "@upstand/api/ai/upgal-ui-targets";
import {
  DEFAULT_TAG_COLOR,
  type TagColor,
  TagColorSchema,
} from "@upstand/domain";
import { Button } from "@upstand/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@upstand/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@upstand/ui/components/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@upstand/ui/components/field";
import { Input } from "@upstand/ui/components/input";
import { Spinner } from "@upstand/ui/components/spinner";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/dashboard/confirm-action-dialog";
import {
  DashboardPage,
  DashboardPageHeader,
} from "@/components/dashboard/dashboard-page";
import { PageEmpty } from "@/components/dashboard/page-empty";
import { CardGridSkeleton } from "@/components/dashboard/page-skeleton";
import {
  Edit2,
  PlusIcon,
  Tag01Icon,
  Trash2Icon,
} from "@/components/huge-icons";
import { UpGalTarget } from "@/components/upgal-target";
import { useRequiredActiveOrganization } from "@/hooks/use-required-active-organization";
import { trpc } from "@/utils/trpc";

const createTagTarget = getUpGalTargetDefinition("create-tag");
const tagNameTarget = getUpGalTargetDefinition("tag-name");
const createTagSubmitTarget = getUpGalTargetDefinition("create-tag-submit");

export default function TagsPage() {
  const organizationState = useRequiredActiveOrganization();
  const organizationId = organizationState.organizationId as string;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(DEFAULT_TAG_COLOR);
  const [editingTag, setEditingTag] = useState<{
    id: string;
    name: string;
    color: TagColor;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const tags = useQuery({
    ...trpc.tag.list.queryOptions({ organizationId }),
    enabled: organizationState.status === "ready",
  });

  const create = useMutation({
    ...trpc.tag.create.mutationOptions(),
    onSuccess: () => {
      toast.success("Tag created");
      setName("");
      setColor(DEFAULT_TAG_COLOR);
      setOpen(false);
      tags.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const update = useMutation({
    ...trpc.tag.update.mutationOptions(),
    onSuccess: () => {
      toast.success("Tag updated");
      setEditingTag(null);
      setName("");
      setColor(DEFAULT_TAG_COLOR);
      setOpen(false);
      void tags.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const remove = useMutation({
    ...trpc.tag.remove.mutationOptions(),
    onSuccess: () => {
      toast.success("Tag deleted");
      setDeleteTarget(null);
      void tags.refetch();
    },
    onError: (error) => toast.error(error.message),
  });

  const parsedColor = TagColorSchema.safeParse(color);
  const colorIsValid = parsedColor.success;

  return (
    <DashboardPage>
      <DashboardPageHeader
        title="Tags"
        description="Organize resources with reusable organization-scoped labels."
        icon={<Tag01Icon className="size-6 text-primary" />}
        actions={
          <UpGalTarget definition={createTagTarget}>
            <Button
              onClick={() => {
                setEditingTag(null);
                setName("");
                setColor(DEFAULT_TAG_COLOR);
                setOpen(true);
              }}
              className="gap-2 font-medium"
            >
              <PlusIcon data-icon="inline-start" />
              Create Tag
            </Button>
          </UpGalTarget>
        }
      />
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tags.isLoading ? (
          <div className="col-span-full">
            <CardGridSkeleton count={3} />
          </div>
        ) : tags.data?.length ? (
          tags.data.map((tag) => (
            <Card key={tag.id} className="gap-3 py-4">
              <CardHeader className="px-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="size-8 shrink-0 rounded-full border"
                      style={{ backgroundColor: tag.color }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <CardTitle className="truncate text-sm">
                        {tag.name}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {tag.color}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      title={`Edit ${tag.name}`}
                      aria-label={`Edit ${tag.name}`}
                      onClick={() => {
                        setEditingTag({
                          id: tag.id,
                          name: tag.name,
                          color: tag.color,
                        });
                        setName(tag.name);
                        setColor(tag.color);
                        setOpen(true);
                      }}
                    >
                      <Edit2 className="size-4" />
                    </Button>
                    <Button
                      variant="destructive"
                      size="icon"
                      className="size-8 text-destructive hover:text-destructive"
                      title={`Delete ${tag.name}`}
                      aria-label={`Delete ${tag.name}`}
                      onClick={() =>
                        setDeleteTarget({ id: tag.id, name: tag.name })
                      }
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))
        ) : (
          <div className="col-span-full">
            <PageEmpty
              icon={Tag01Icon}
              title="No tags yet"
              description="Create a shared label to organize resources, environments, and operations."
              action={
                <UpGalTarget definition={createTagTarget}>
                  <Button
                    onClick={() => {
                      setEditingTag(null);
                      setName("");
                      setColor(DEFAULT_TAG_COLOR);
                      setOpen(true);
                    }}
                    className="gap-2"
                  >
                    <PlusIcon data-icon="inline-start" />
                    Create Tag
                  </Button>
                </UpGalTarget>
              }
            />
          </div>
        )}
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTag ? "Edit Tag" : "Create Tag"}</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim() || !parsedColor.success) return;
              const validColor = parsedColor.data;
              if (editingTag)
                update.mutate({
                  id: editingTag.id,
                  organizationId,
                  name: name.trim(),
                  color: validColor,
                });
              else
                create.mutate({
                  organizationId,
                  name: name.trim(),
                  color: validColor,
                });
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="tag-name">Name</FieldLabel>
                <UpGalTarget definition={tagNameTarget}>
                  <Input
                    id="tag-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoFocus
                  />
                </UpGalTarget>
              </Field>
              <Field data-invalid={!colorIsValid}>
                <FieldLabel htmlFor="tag-color">Color</FieldLabel>
                <div className="flex items-center gap-2">
                  <div
                    className={`relative size-10 shrink-0 overflow-hidden rounded-full border shadow-sm ${
                      colorIsValid ? "border-border" : "border-destructive"
                    }`}
                  >
                    <input
                      id="tag-color-picker"
                      type="color"
                      value={colorIsValid ? color : DEFAULT_TAG_COLOR}
                      onChange={(event) => setColor(event.target.value)}
                      aria-invalid={!colorIsValid}
                      aria-label="Choose tag color"
                      className="absolute -top-1 -left-1 size-12 cursor-pointer appearance-none border-none bg-transparent p-0 [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-none [&::-webkit-color-swatch]:border-none"
                    />
                  </div>
                  <Input
                    id="tag-color"
                    value={color}
                    onChange={(event) => setColor(event.target.value)}
                    placeholder="#6366f1"
                    aria-invalid={!colorIsValid}
                    className="font-mono uppercase"
                  />
                </div>
                {colorIsValid ? (
                  <FieldDescription>
                    Choose a color or enter a 6-digit hex value.
                  </FieldDescription>
                ) : (
                  <FieldError>
                    Enter a valid 6-digit hex color, such as #6366f1.
                  </FieldError>
                )}
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <UpGalTarget definition={createTagSubmitTarget}>
                <Button
                  type="submit"
                  disabled={
                    create.isPending ||
                    update.isPending ||
                    !name.trim() ||
                    !colorIsValid
                  }
                >
                  {create.isPending || update.isPending ? (
                    <>
                      <Spinner data-icon="inline-start" />
                      Saving…
                    </>
                  ) : editingTag ? (
                    "Save Changes"
                  ) : (
                    "Create Tag"
                  )}
                </Button>
              </UpGalTarget>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmActionDialog
        open={deleteTarget !== null}
        onOpenChange={(nextOpen) => !nextOpen && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name ?? "Tag"}?`}
        description={`${deleteTarget?.name ?? "This tag"} will be removed from the organization and detached from resources. This action cannot be undone.`}
        actionLabel="Delete Tag"
        pending={remove.isPending}
        onConfirm={() => {
          if (deleteTarget) {
            remove.mutate({ id: deleteTarget.id, organizationId });
          }
        }}
      />
    </DashboardPage>
  );
}
