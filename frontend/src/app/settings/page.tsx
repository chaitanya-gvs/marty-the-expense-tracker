import { MainLayout } from "@/components/layout/main-layout";
import { CategoriesManager } from "@/components/settings/categories-manager";
import { TagsManager } from "@/components/settings/tags-manager";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function SettingsPage() {
  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Settings</h1>
          <p className="text-gray-600 dark:text-gray-300 mt-2">
            Manage categories, tags, and application preferences
          </p>
        </div>
        
        <Tabs defaultValue="categories" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="categories">Categories</TabsTrigger>
            <TabsTrigger value="tags">Tags</TabsTrigger>
          </TabsList>
          <TabsContent value="categories" className="space-y-4">
            <CategoriesManager />
          </TabsContent>
          <TabsContent value="tags" className="space-y-4">
            <TagsManager />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
