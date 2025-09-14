"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useTags, useCreateTag } from "@/hooks/use-tags";
import { Plus, Hash } from "lucide-react";

export function TagsManager() {
  const { data: tagsData, isLoading } = useTags();
  const createTag = useCreateTag();
  
  const tags = tagsData?.data || [];
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newTag, setNewTag] = useState({
    name: "",
    color: "#6b7280",
  });

  const handleCreateTag = async () => {
    await createTag.mutateAsync(newTag);
    setNewTag({ name: "", color: "#6b7280" });
    setIsCreateDialogOpen(false);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tags</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-200 rounded animate-pulse"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Tags</CardTitle>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Tag
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Tag</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="tag-name">Name</Label>
                  <Input
                    id="tag-name"
                    value={newTag.name}
                    onChange={(e) => setNewTag({ ...newTag, name: e.target.value })}
                    placeholder="Enter tag name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tag-color">Color</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="tag-color"
                      type="color"
                      value={newTag.color}
                      onChange={(e) => setNewTag({ ...newTag, color: e.target.value })}
                      className="w-16 h-10"
                    />
                    <Input
                      value={newTag.color}
                      onChange={(e) => setNewTag({ ...newTag, color: e.target.value })}
                      placeholder="#6b7280"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreateTag} disabled={!newTag.name}>
                    Create Tag
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {tags.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No tags created yet. Create tags to better organize and filter your transactions.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {tags.map((tag) => (
                <div
                  key={tag.id}
                  className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    <h3 className="font-medium">{tag.name}</h3>
                  </div>
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-xs">
                      <Hash className="h-3 w-3 mr-1" />
                      {tag.usage_count} uses
                    </Badge>
                    <Badge
                      variant="outline"
                      className="text-xs"
                      style={{ 
                        backgroundColor: tag.color + "20",
                        borderColor: tag.color,
                        color: tag.color
                      }}
                    >
                      Preview
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
