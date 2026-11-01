import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Snowflake, Trash2, Truck } from 'lucide-react';

import { ConfirmDialog, Money, PageHeader, QueryState, useKgFormatter } from '@/components/domain';
import { StaggerGroup, StaggerItem } from '@/components/motion';
import { Badge, Button, Card, Switch, toast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { Seo } from '@/lib/seo';
import type { Vehicle } from '@/types/api';

import { VehicleDialog } from '@/features/transporter/components/VehicleDialog';
import { VehicleGlyph } from '@/features/transporter/components/VehicleGlyph';
import { SAMPLE_TRIP_KM, fareFor, isRefrigerated, vehicleRates } from '@/features/transporter/fleet';
import { errorMessage } from '@/features/transporter/forms';
import { useDeleteVehicle, useUpdateVehicle, useVehicles } from '@/features/transporter/hooks';

export default function VehiclesPage() {
  const { t } = useTranslation('transporter');
  const vehicles = useVehicles();
  const update = useUpdateVehicle();
  const remove = useDeleteVehicle();
  const formatKg = useKgFormatter();
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Vehicle | null>(null);

  const toggle = (vehicle: Vehicle, active: boolean) => {
    update.mutate(
      { id: vehicle.id, req: { is_active: active } },
      {
        onSuccess: () =>
          toast.success(
            active
              ? t('fleet.activated', { defaultValue: '{{reg}} is available for quotes', reg: vehicle.registration_number })
              : t('fleet.deactivated', { defaultValue: '{{reg}} is paused', reg: vehicle.registration_number }),
          ),
        onError: (error) => toast.error(errorMessage(error, t('fleet.saveFailed', { defaultValue: 'Could not save the vehicle' }))),
      },
    );
  };

  const onDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      toast.success(t('fleet.removed', { defaultValue: 'Vehicle removed' }));
    } catch (error) {
      toast.error(errorMessage(error, t('fleet.removeFailed', { defaultValue: 'Could not remove the vehicle' })));
      throw error;
    }
  };

  const addButton = (
    <Button leadingIcon={<Plus strokeWidth={1.25} />} onClick={() => setAdding(true)}>
      {t('fleet.add', { defaultValue: 'Add vehicle' })}
    </Button>
  );

  return (
    <div className="flex flex-col gap-8">
      <Seo title={t('fleet.seoTitle', { defaultValue: 'My fleet' })} description={t('fleet.seoDescription', { defaultValue: 'Vehicles, capacity and rates used for your quotes.' })} path="/app/transporter/vehicles" noindex />
      <PageHeader
        eyebrow={t('fleet.eyebrow', { defaultValue: 'Fleet' })}
        title={t('fleet.title', { defaultValue: 'My vehicles' })}
        description={t('fleet.description', { defaultValue: 'Capacity and rates for each vehicle. Active vehicles are matched to loads and pre-fill your quotes.' })}
        breadcrumbs={[{ label: t('nav.home', { defaultValue: 'Home' }), to: '/app/transporter' }, { label: t('fleet.title', { defaultValue: 'My vehicles' }) }]}
        actions={addButton}
        divider
      />

      <QueryState
        query={vehicles}
        skeleton="cards"
        errorTitle={t('fleet.error', { defaultValue: 'Could not load your vehicles' })}
        empty={{
          icon: <Truck strokeWidth={1.25} />,
          title: t('fleet.empty', { defaultValue: 'No vehicles yet' }),
          description: t('fleet.emptyBody', { defaultValue: 'Add a vehicle to see which loads fit and to quote faster.' }),
          action: addButton,
        }}
      >
        {(list) => (
          <StaggerGroup className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {list.map((vehicle) => (
              <StaggerItem key={vehicle.id}>
                <Card as="article" className={cn('flex h-full flex-col overflow-hidden', !vehicle.is_active && 'opacity-80')}>
                  <VehicleGlyph type={vehicle.vehicle_type} muted={!vehicle.is_active} className="h-32 w-full border-b border-line bg-parchment/40" />
                  <div className="flex flex-1 flex-col gap-4 p-5 sm:p-6">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="eyebrow">{t(`common:enums.vehicleType.${vehicle.vehicle_type}`)}</p>
                        <h2 className="mt-1 truncate font-display font-bold text-h3 tracking-wide text-ink">{vehicle.registration_number}</h2>
                      </div>
                      <Badge tone={vehicle.is_active ? 'success' : 'neutral'} dot size="sm">
                        {vehicle.is_active ? t('fleet.active', { defaultValue: 'Active' }) : t('fleet.paused', { defaultValue: 'Paused' })}
                      </Badge>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-line py-4 text-sm">
                      <div>
                        <dt className="text-[13px] font-semibold text-muted">{t('fleet.capacity', { defaultValue: 'Capacity' })}</dt>
                        <dd className="tabular-nums text-ink">{formatKg(vehicle.capacity_kg)}</dd>
                      </div>
                      <div>
                        <dt className="text-[13px] font-semibold text-muted">{t('fleet.cold', { defaultValue: 'Cold chain' })}</dt>
                        <dd className="flex items-center gap-1 text-ink">
                          {isRefrigerated(vehicle) ? <><Snowflake aria-hidden="true" strokeWidth={1.25} className="size-3.5 text-muted" />{t('fleet.yes', { defaultValue: 'Yes' })}</> : t('fleet.no', { defaultValue: 'No' })}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[13px] font-semibold text-muted">{t('fleet.rates', { defaultValue: 'Rates' })}</dt>
                        <dd className="tabular-nums text-ink">
                          <Money value={vehicle.base_charge} size="sm" /> + <Money value={vehicle.per_km_rate} size="sm" />/km
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[13px] font-semibold text-muted">{t('fleet.sample', { defaultValue: '{{km}} km run', km: SAMPLE_TRIP_KM })}</dt>
                        <dd><Money value={fareFor(vehicleRates(vehicle), SAMPLE_TRIP_KM)} size="sm" /></dd>
                      </div>
                    </dl>
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
                      <Switch
                        checked={vehicle.is_active}
                        onCheckedChange={(active) => toggle(vehicle, active)}
                        label={t('fleet.availability', { defaultValue: 'Available' })}
                        aria-label={t('fleet.toggleLabel', { defaultValue: 'Available for quotes: {{reg}}', reg: vehicle.registration_number })}
                      />
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" leadingIcon={<Pencil strokeWidth={1.25} />} onClick={() => setEditing(vehicle)}>
                          {t('fleet.edit', { defaultValue: 'Edit' })}
                        </Button>
                        <Button variant="ghost" size="sm" leadingIcon={<Trash2 strokeWidth={1.25} />} onClick={() => setDeleting(vehicle)} aria-label={t('fleet.removeLabel', { defaultValue: 'Remove {{reg}}', reg: vehicle.registration_number })}>
                          {t('fleet.remove', { defaultValue: 'Remove' })}
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              </StaggerItem>
            ))}
          </StaggerGroup>
        )}
      </QueryState>

      <VehicleDialog
        open={adding || editing !== null}
        vehicle={editing}
        onOpenChange={(open) => {
          if (!open) {
            setAdding(false);
            setEditing(null);
          }
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title={t('fleet.removeTitle', { defaultValue: 'Remove {{reg}}?', reg: deleting?.registration_number ?? '' })}
        description={t('fleet.removeBody', { defaultValue: 'It will no longer be offered for quotes. Pause it instead if it is only off the road for a while.' })}
        confirmLabel={t('fleet.remove', { defaultValue: 'Remove' })}
        tone="danger"
        onConfirm={onDelete}
      />
    </div>
  );
}
