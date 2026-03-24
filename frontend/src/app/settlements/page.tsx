"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MainLayout } from '@/components/layout/main-layout';
import { SplitwiseTab } from '@/components/settlements/splitwise-tab';
import { ManualTab } from '@/components/settlements/manual-tab';

export default function SettlementsPage() {
  return (
    <MainLayout>
      <div className="container mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Settlements &amp; Balances</h1>
          <p className="text-gray-600 mt-1">Track what you owe and what others owe you</p>
        </div>
        <Tabs defaultValue="splitwise">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="splitwise">Splitwise</TabsTrigger>
            <TabsTrigger value="manual">Manual Computation</TabsTrigger>
          </TabsList>
          <TabsContent value="splitwise">
            <SplitwiseTab />
          </TabsContent>
          <TabsContent value="manual">
            <ManualTab />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
