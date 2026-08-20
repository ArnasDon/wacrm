'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Vehicle {
  id: string;
  vehicle_type: string;
  manufacturer: string;
  model: string;
  engine: string;
}

export default function VehiclesPage() {
  const { loading: authLoading, accountId, canEditSettings } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [vehicleType, setVehicleType] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [engine, setEngine] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/vehicles');
      const data = await res.json();
      if (res.ok) setVehicles(data.vehicles ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !accountId) return;
    void load();
  }, [authLoading, accountId, load]);

  async function handleAdd() {
    if (!vehicleType.trim() || !manufacturer.trim() || !model.trim()) {
      toast.error('Vehicle type, manufacturer, and model are required.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicle_type: vehicleType.trim(),
          manufacturer: manufacturer.trim(),
          model: model.trim(),
          engine: engine.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to add vehicle.');
        return;
      }
      toast.success('Vehicle added.');
      setVehicleType('');
      setManufacturer('');
      setModel('');
      setEngine('');
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (
      !confirm(
        'Delete this vehicle? Any recorded compatibility with it will be removed too.'
      )
    )
      return;
    const res = await fetch(`/api/vehicles/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || 'Failed to delete vehicle.');
      return;
    }
    toast.success('Vehicle deleted.');
    await load();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/products"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-3.5" />
          Back to Products
        </Link>
        <h1 className="text-foreground mt-2 text-2xl font-bold">Vehicles</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Vehicle Type / Manufacturer / Model / Engine entries — reference data
          for the &ldquo;Verified compatibility&rdquo; list on each product
          (§11).
        </p>
      </div>

      {canEditSettings && (
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">Add a vehicle</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="vehicle-type">Vehicle type</Label>
                <Input
                  id="vehicle-type"
                  value={vehicleType}
                  onChange={(e) => setVehicleType(e.target.value)}
                  placeholder="e.g. Heavy Truck"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vehicle-manufacturer">Manufacturer</Label>
                <Input
                  id="vehicle-manufacturer"
                  value={manufacturer}
                  onChange={(e) => setManufacturer(e.target.value)}
                  placeholder="e.g. Hino"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vehicle-model">Model</Label>
                <Input
                  id="vehicle-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. 500 Series"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vehicle-engine">Engine (optional)</Label>
                <Input
                  id="vehicle-engine"
                  value={engine}
                  onChange={(e) => setEngine(e.target.value)}
                  placeholder="e.g. J08E"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => void handleAdd()} disabled={saving}>
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                Add vehicle
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">All vehicles</CardTitle>
          <CardDescription>{vehicles.length} recorded</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-muted-foreground flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : vehicles.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No vehicles recorded yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Manufacturer</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Engine</TableHead>
                  {canEditSettings && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicles.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>{v.vehicle_type}</TableCell>
                    <TableCell>{v.manufacturer}</TableCell>
                    <TableCell>{v.model}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {v.engine || '—'}
                    </TableCell>
                    {canEditSettings && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => void handleDelete(v.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Link href="/products" className={buttonVariants({ variant: 'outline' })}>
        Back to Products
      </Link>
    </div>
  );
}
