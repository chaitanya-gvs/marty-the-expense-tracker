"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MainLayout } from '@/components/layout/main-layout';
import { SplitwiseTab } from '@/components/settlements/splitwise-tab';
import { ManualTab } from '@/components/settlements/manual-tab';

export default function SettlementsPage() {
  return (
    <MainLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">Settlements &amp; Balances</h1>
          <p className="text-sm text-muted-foreground mt-1">Track what you owe and what others owe you</p>
        </div>
        <Tabs defaultValue="splitwise">
          <TabsList className="w-full grid grid-cols-2 h-auto md:inline-flex md:w-fit md:h-9">
            <TabsTrigger value="splitwise" className="min-h-11 md:min-h-0">Splitwise</TabsTrigger>
            <TabsTrigger value="manual" className="min-h-11 md:min-h-0">Manual Computation</TabsTrigger>
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
