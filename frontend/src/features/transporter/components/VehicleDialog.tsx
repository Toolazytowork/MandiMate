import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Button, Checkbox, Dialog, Field, Input, Select, toast } from '@/components/ui';
import type { Vehicle, VehicleType } from '@/types/api';

import { VEHICLE_CAPACITY_MAX_KG, VEHICLE_CAPACITY_MIN_KG, VEHICLE_CLASSES, VEHICLE_TYPES } from '../fleet';
import { applyApiFieldErrors, errorMessage, numberField } from '../forms';
import { useCreateVehicle, useUpdateVehicle } from '../hooks';

interface VehicleInput {
  vehicle_type: string;
  registration_number: string;
  capacity_kg: string;
  has_refrigeration: boolean;
  base_charge: string;
  per_km_rate: string;
}

const FIELDS = ['vehicle_type', 'registration_number', 'capacity_kg', 'has_refrigeration', 'base_charge', 'per_km_rate'] as const;

export interface VehicleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this vehicle; omit to add a new one. */
  vehicle?: Vehicle | null;
}

function defaults(vehicle?: Vehicle | null): VehicleInput {
  if (vehicle) {
    return {
      vehicle_type: vehicle.vehicle_type,
      registration_number: vehicle.registration_number,
      capacity_kg: String(vehicle.capacity_kg),
      has_refrigeration: vehicle.has_refrigeration,
      base_charge: String(vehicle.base_charge),
      per_km_rate: String(vehicle.per_km_rate),
    };
  }
  const base = VEHICLE_CLASSES.pickup;
  return { vehicle_type: 'pickup', registration_number: '', capacity_kg: String(base.capacityKg), has_refrigeration: false, base_charge: String(base.baseCharge), per_km_rate: String(base.perKm) };
}

/** Add or edit a vehicle: class, registration, capacity, cold chain and the rates quotes start from. */
export function VehicleDialog({ open, onOpenChange, vehicle }: VehicleDialogProps) {
  const { t } = useTranslation('transporter');
  const create = useCreateVehicle();
  const update = useUpdateVehicle();
  const pending = create.isPending || update.isPending;
  const editing = Boolean(vehicle);

  const schema = z.object({
    vehicle_type: z
      .string()
      .refine((value) => (VEHICLE_TYPES as readonly string[]).includes(value), t('fleet.errors.type', { defaultValue: 'Choose a vehicle type' }))
      .transform((value) => value as VehicleType),
    registration_number: z
      .string()
      .trim()
      .min(4, t('fleet.errors.registration', { defaultValue: 'Enter the registration number' }))
      .max(20, t('fleet.errors.registrationLong', { defaultValue: 'That registration is too long' }))
      .transform((value) => value.toUpperCase()),
    capacity_kg: numberField({
      required: t('fleet.errors.capacity', { defaultValue: 'Enter the capacity' }),
      invalid: t('fleet.errors.number', { defaultValue: 'Enter a number' }),
      min: { value: VEHICLE_CAPACITY_MIN_KG, message: t('fleet.errors.capacityMin', { defaultValue: 'At least {{min}} kg', min: VEHICLE_CAPACITY_MIN_KG }) },
      max: { value: VEHICLE_CAPACITY_MAX_KG, message: t('fleet.errors.capacityMax', { defaultValue: 'At most {{max}} kg', max: VEHICLE_CAPACITY_MAX_KG.toLocaleString('en-IN') }) },
    }),
    has_refrigeration: z.boolean(),
    base_charge: numberField({
      required: t('fleet.errors.base', { defaultValue: 'Enter a base charge' }),
      invalid: t('fleet.errors.number', { defaultValue: 'Enter a number' }),
      min: { value: 0, message: t('fleet.errors.negative', { defaultValue: 'Cannot be negative' }) },
    }),
    per_km_rate: numberField({
      required: t('fleet.errors.perKm', { defaultValue: 'Enter a per-km rate' }),
      invalid: t('fleet.errors.number', { defaultValue: 'Enter a number' }),
      min: { value: 0, message: t('fleet.errors.negative', { defaultValue: 'Cannot be negative' }) },
    }),
  });

  const { register, handleSubmit, setError, setValue, formState: { errors } } = useForm<VehicleInput, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    values: open ? defaults(vehicle) : undefined,
  });

  const onTypeChange = (type: string) => {
    if (editing || !(VEHICLE_TYPES as readonly string[]).includes(type)) return;
    const vehicleClass = VEHICLE_CLASSES[type as VehicleType];
    setValue('capacity_kg', String(vehicleClass.capacityKg));
    setValue('base_charge', String(vehicleClass.baseCharge));
    setValue('per_km_rate', String(vehicleClass.perKm));
    setValue('has_refrigeration', vehicleClass.refrigerated);
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (vehicle) {
        await update.mutateAsync({ id: vehicle.id, req: values });
        toast.success(t('fleet.saved', { defaultValue: 'Vehicle updated' }));
      } else {
        await create.mutateAsync(values);
        toast.success(t('fleet.added', { defaultValue: 'Vehicle added' }), { description: t('fleet.addedBody', { defaultValue: '{{reg}} can now be used in quotes.', reg: values.registration_number }) });
      }
      onOpenChange(false);
    } catch (error) {
      if (!applyApiFieldErrors(error, setError, FIELDS)) {
        toast.error(errorMessage(error, t('fleet.saveFailed', { defaultValue: 'Could not save the vehicle' })));
      }
    }
  });

  const typeField = register('vehicle_type');

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      dismissible={!pending}
      title={editing ? t('fleet.editTitle', { defaultValue: 'Edit vehicle' }) : t('fleet.addTitle', { defaultValue: 'Add a vehicle' })}
      description={t('fleet.dialogDescription', { defaultValue: 'Your rates pre-fill every quote — you can still adjust the price on each request.' })}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>{t('fleet.cancel', { defaultValue: 'Cancel' })}</Button>
          <Button type="submit" form="vehicle-form" loading={pending}>{editing ? t('fleet.save', { defaultValue: 'Save changes' }) : t('fleet.add', { defaultValue: 'Add vehicle' })}</Button>
        </>
      }
    >
      <form id="vehicle-form" noValidate onSubmit={onSubmit} className="grid gap-5 sm:grid-cols-2">
        <Field label={t('fleet.type', { defaultValue: 'Vehicle type' })} error={errors.vehicle_type?.message} required>
          <Select
            {...typeField}
            onChange={(event) => {
              void typeField.onChange(event);
              onTypeChange(event.target.value);
            }}
          >
            {VEHICLE_TYPES.map((type) => (
              <option key={type} value={type}>{t(`common:enums.vehicleType.${type}`)}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('fleet.registration', { defaultValue: 'Registration number' })} error={errors.registration_number?.message} required>
          <Input autoComplete="off" autoCapitalize="characters" placeholder="MH 12 AB 3456" {...register('registration_number')} />
        </Field>
        <Field label={t('fleet.capacity', { defaultValue: 'Capacity' })} error={errors.capacity_kg?.message} required>
          <Input inputMode="numeric" autoComplete="off" trailing="kg" {...register('capacity_kg')} />
        </Field>
        <Field label={t('fleet.baseCharge', { defaultValue: 'Base charge' })} error={errors.base_charge?.message} hint={t('fleet.baseHint', { defaultValue: 'Per trip, before distance' })} required>
          <Input inputMode="decimal" autoComplete="off" leading="₹" {...register('base_charge')} />
        </Field>
        <Field label={t('fleet.perKm', { defaultValue: 'Rate per km' })} error={errors.per_km_rate?.message} required>
          <Input inputMode="decimal" autoComplete="off" leading="₹" trailing="/km" {...register('per_km_rate')} />
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox label={t('fleet.refrigerated', { defaultValue: 'Refrigerated (cold chain)' })} {...register('has_refrigeration')} />
        </div>
      </form>
    </Dialog>
  );
}
