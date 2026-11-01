import { zodResolver } from '@hookform/resolvers/zod';
import { Ban, Combine, MapPinned, ScrollText, Sparkles, Target, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';

import { AiPanel, GradeBadge, Money, PageHeader, Quantity, RouteMap, SectionCard, type RouteMapStop } from '@/components/domain';
import { Badge, Button, Card, EmptyState, Field, Input, Progress, Select, Switch, toast } from '@/components/ui';
import { Reveal } from '@/components/motion';
import { useCreateLot, useCrops, useHarvestList, useMatchExplanation, useMatchPreview, useOpenDemands } from '@/features/coordinator/hooks';
import { DEFAULT_RADIUS_KM, MATCH_GRADES, MAX_RADIUS_KM, MIN_RADIUS_KM, STATE_AP, VILLAGES } from '@/features/coordinator/constants';
import {
  addDays,
  adjustedProposal,
  allocationMembers,
  allocationTotal,
  applyFieldErrors,
  clampKg,
  errorMessage,
  feasibilityThreshold,
  initialAllocation,
  orderPickupStops,
  suggestedKgOnInclude,
  type Allocation,
} from '@/features/coordinator/utils';
import { CandidateRow } from '@/features/coordinator-lots/components/CandidateRow';
import { cn } from '@/lib/cn';
import { formatDate, formatNumber, todayIST } from '@/lib/format';
import { Seo } from '@/lib/seo';
import type { Demand, Grade, MatchPreviewRequest, MatchProposal } from '@/types/api';

interface Preset {
  id: string;
  name: string;
  label: string;
  latitude: number;
  longitude: number;
  district: string;
}

const PRESETS: readonly Preset[] = [
  { id: 'madanapalle', label: 'Madanapalle', name: 'Madanapalle collection point', latitude: 13.5503, longitude: 78.5029, district: 'Annamayya' },
  { id: 'punganur', label: 'Punganur', name: 'Punganur collection point', latitude: 13.365, longitude: 78.573, district: 'Chittoor' },
  { id: 'kurabalakota', label: 'Kurabalakota', name: 'Kurabalakota collection point', latitude: 13.65, longitude: 78.48, district: 'Annamayya' },
  { id: 'b_kothakota', label: 'B. Kothakota', name: 'B. Kothakota collection point', latitude: 13.6575, longitude: 78.2697, district: 'Annamayya' },
];

interface BuilderValues {
  demand_id: string;
  crop_id: string;
  grade: Grade;
  target_quantity_kg: string;
  collection_point_name: string;
  collection_latitude: string;
  collection_longitude: string;
  pickup_date: string;
  radius_km: string;
  include_ungraded: boolean;
}

const BUILDER_FIELDS = [
  'crop_id',
  'grade',
  'target_quantity_kg',
  'collection_point_name',
  'collection_latitude',
  'collection_longitude',
  'pickup_date',
  'radius_km',
] as const;

function toRequest(values: BuilderValues): MatchPreviewRequest {
  return {
    crop_id: values.crop_id,
    grade: values.grade,
    target_quantity_kg: Number(values.target_quantity_kg),
    collection_latitude: Number(values.collection_latitude),
    collection_longitude: Number(values.collection_longitude),
    pickup_date: values.pickup_date,
    radius_km: Number(values.radius_km),
    demand_id: values.demand_id || null,
    include_ungraded: values.include_ungraded,
  };
}

function demandPickupDate(demand: Demand): string {
  const today = todayIST();
  const dayBefore = addDays(demand.needed_by, -1);
  return dayBefore < today ? today : dayBefore;
}

export default function LotBuilderPage() {
  const { t } = useTranslation('coordinatorLots');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const crops = useCrops();
  const demands = useOpenDemands();
  const preview = useMatchPreview();
  const explain = useMatchExplanation();
  const createLot = useCreateLot();

  const [proposal, setProposal] = useState<MatchProposal | null>(null);
  const [allocation, setAllocation] = useState<Allocation>({});
  const [previewedWith, setPreviewedWith] = useState<{ req: MatchPreviewRequest; name: string; district: string | null } | null>(null);

  const schema = useMemo(() => {
    const decimal = (msg: string, check: (n: number) => boolean) =>
      z
        .string()
        .trim()
        .min(1, msg)
        .refine((v) => Number.isFinite(Number(v)) && check(Number(v)), msg);
    return z.object({
      demand_id: z.string(),
      crop_id: z.string().min(1, t('builder.errors.crop', { defaultValue: 'Choose a crop' })),
      grade: z.enum(['A', 'B', 'C', 'ungraded']),
      target_quantity_kg: decimal(t('builder.errors.target', { defaultValue: 'Target must be between 50 and 100,000 kg' }), (n) => n >= 50 && n <= 100_000),
      collection_point_name: z.string().trim().min(2, t('builder.errors.point', { defaultValue: 'Name the collection point' })).max(120),
      collection_latitude: decimal(t('builder.errors.lat', { defaultValue: 'Latitude between 6 and 37' }), (n) => n >= 6 && n <= 37),
      collection_longitude: decimal(t('builder.errors.lng', { defaultValue: 'Longitude between 68 and 98' }), (n) => n >= 68 && n <= 98),
      pickup_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, t('builder.errors.date', { defaultValue: 'Choose a pickup date' }))
        .refine((v) => v >= todayIST(), t('builder.errors.datePast', { defaultValue: 'Pickup cannot be in the past' })),
      radius_km: z.string(),
      include_ungraded: z.boolean(),
    });
  }, [t]);

  const firstPreset = PRESETS[0]!;
  const form = useForm<BuilderValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      demand_id: '',
      crop_id: '',
      grade: 'A',
      target_quantity_kg: '1000',
      collection_point_name: firstPreset.name,
      collection_latitude: String(firstPreset.latitude),
      collection_longitude: String(firstPreset.longitude),
      pickup_date: addDays(todayIST(), 2),
      radius_km: String(DEFAULT_RADIUS_KM),
      include_ungraded: false,
    },
  });
  const { register, handleSubmit, setValue, watch, setError, formState } = form;
  const values = watch();
  const selectedCrop = crops.data?.find((crop) => crop.id === values.crop_id);
  const gradeOptions = (selectedCrop?.grades.filter((grade) => grade !== 'ungraded') ?? MATCH_GRADES) as Grade[];
  const selectedDemand = demands.data?.find((demand) => demand.id === values.demand_id) ?? null;
  const district = PRESETS.find((preset) => preset.name === values.collection_point_name)?.district ?? null;

  // Default crop once the catalogue arrives.
  useEffect(() => {
    if (!values.crop_id && crops.data?.[0]) setValue('crop_id', crops.data[0].id);
  }, [crops.data, values.crop_id, setValue]);

  const applyDemand = (demandId: string) => {
    setValue('demand_id', demandId);
    const demand = demands.data?.find((item) => item.id === demandId);
    if (!demand) return;
    setValue('crop_id', demand.crop_id, { shouldValidate: true });
    setValue('grade', demand.grade_required === 'ungraded' ? 'A' : demand.grade_required, { shouldValidate: true });
    setValue('target_quantity_kg', String(demand.quantity_kg), { shouldValidate: true });
    setValue('pickup_date', demandPickupDate(demand), { shouldValidate: true });
  };

  // ?demand=<id> pre-fills from an open buyer demand (once).
  const appliedParam = useRef(false);
  useEffect(() => {
    const id = searchParams.get('demand');
    if (!id || appliedParam.current || !demands.data) return;
    appliedParam.current = true;
    if (demands.data.some((demand) => demand.id === id)) applyDemand(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demands.data, searchParams]);

  const choosePreset = (preset: Preset) => {
    setValue('collection_point_name', preset.name, { shouldValidate: true });
    setValue('collection_latitude', String(preset.latitude), { shouldValidate: true });
    setValue('collection_longitude', String(preset.longitude), { shouldValidate: true });
  };

  const onPreview = handleSubmit((data) => {
    const req = toRequest(data);
    explain.reset();
    preview.mutate(req, {
      onSuccess: (result) => {
        setProposal(result);
        setAllocation(initialAllocation(result));
        setPreviewedWith({ req, name: data.collection_point_name.trim(), district });
      },
      onError: (error) => {
        if (!applyFieldErrors(error, setError, BUILDER_FIELDS)) toast.error(errorMessage(error));
      },
    });
  });

  const stale =
    previewedWith !== null &&
    (JSON.stringify(previewedWith.req) !== JSON.stringify(toRequest(values)) || previewedWith.name !== values.collection_point_name.trim());

  // Coordinates for the map: from the harvest records, falling back to the village centre.
  const harvests = useHarvestList({ crop_id: proposal?.crop_id ?? null, limit: 200 }, { enabled: Boolean(proposal) });
  const demandMin = selectedDemand && selectedDemand.id === proposal?.demand_id ? selectedDemand.min_quantity_kg : null;
  const edited = proposal ? adjustedProposal(proposal, allocation, demandMin) : null;
  const total = proposal ? allocationTotal(proposal, allocation) : 0;
  const members = proposal ? allocationMembers(proposal, allocation) : [];
  const threshold = proposal ? feasibilityThreshold(proposal.target_quantity_kg, demandMin) : 0;

  const route = useMemo(() => {
    if (!proposal) return null;
    const byId = new Map((harvests.data ?? []).map((harvest) => [harvest.id, harvest]));
    const points = proposal.candidates
      .filter((candidate) => allocation[candidate.harvest_id]?.included)
      .map((candidate) => {
        const harvest = byId.get(candidate.harvest_id);
        const village = VILLAGES.find((item) => item.name.toLowerCase() === (candidate.village ?? '').toLowerCase());
        const latitude = harvest?.latitude ?? village?.latitude;
        const longitude = harvest?.longitude ?? village?.longitude;
        if (latitude == null || longitude == null) return null;
        return { id: candidate.harvest_id, latitude, longitude, candidate };
      })
      .filter((point): point is NonNullable<typeof point> => point !== null);
    const destination: [number, number] = [proposal.collection_latitude, proposal.collection_longitude];
    const { ordered, roadKm } = orderPickupStops(points, destination);
    const stops: RouteMapStop[] = ordered.map((point, index) => ({
      id: point.id,
      sequence: index + 1,
      farmer_name: point.candidate.farmer_name,
      village: point.candidate.village,
      latitude: point.latitude,
      longitude: point.longitude,
      quantity_kg: clampKg(point.candidate, allocation[point.id]?.kg ?? 0),
      status: 'pending',
    }));
    return { stops, roadKm, order: new Map(ordered.map((point, index) => [point.id, index + 1])) };
  }, [proposal, allocation, harvests.data]);

  const toggle = (harvestId: string, included: boolean) => {
    if (!proposal) return;
    const candidate = proposal.candidates.find((item) => item.harvest_id === harvestId);
    if (!candidate) return;
    setAllocation((current) => ({
      ...current,
      [harvestId]: { included, kg: included ? suggestedKgOnInclude(candidate, proposal, current) : current[harvestId]?.kg ?? 0 },
    }));
    explain.reset();
  };

  const setKg = (harvestId: string, kg: number) => {
    const candidate = proposal?.candidates.find((item) => item.harvest_id === harvestId);
    if (!candidate) return;
    const clamped = clampKg(candidate, kg);
    if (clamped < kg) toast.info(t('builder.clamped', { defaultValue: '{{name}} has only {{kg}} kg available', name: candidate.farmer_name, kg: candidate.available_kg }));
    setAllocation((current) => ({ ...current, [harvestId]: { included: clamped > 0, kg: clamped } }));
    explain.reset();
  };

  const onCreate = () => {
    if (!proposal || !previewedWith) return;
    createLot.mutate(
      {
        crop_id: proposal.crop_id,
        grade: proposal.grade,
        demand_id: proposal.demand_id,
        target_quantity_kg: proposal.target_quantity_kg,
        collection_point_name: previewedWith.name,
        collection_latitude: proposal.collection_latitude,
        collection_longitude: proposal.collection_longitude,
        district: previewedWith.district,
        state: STATE_AP,
        pickup_date: proposal.pickup_date,
        members,
        match_explanation: explain.data?.text ?? edited?.explanation ?? proposal.explanation,
      },
      {
        onSuccess: (lot) => {
          toast.success(t('builder.created', { defaultValue: '{{code}} created — farmers are asked to consent', code: lot.code }));
          navigate(`/app/coordinator/lots/${lot.id}`);
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  };

  const selected = proposal?.candidates.filter((candidate) => allocation[candidate.harvest_id]?.included) ?? [];
  const unselected = proposal?.candidates.filter((candidate) => !allocation[candidate.harvest_id]?.included) ?? [];
  const pct = proposal && proposal.target_quantity_kg > 0 ? Math.min(100, (total / proposal.target_quantity_kg) * 100) : 0;
  const feasible = total >= threshold && total > 0;
  const shortfall = proposal ? Math.max(0, proposal.target_quantity_kg - total) : 0;
  const errors = formState.errors;

  return (
    <div className="space-y-10">
      <Seo
        title={t('builder.seoTitle', { defaultValue: 'Lot builder' })}
        description={t('builder.seoDescription', { defaultValue: 'Find compatible harvests and group them into a buyer-ready lot.' })}
        path="/app/coordinator/lot-builder"
        noindex
      />
      <PageHeader
        eyebrow={t('builder.eyebrow', { defaultValue: 'Lot builder' })}
        title={t('builder.title', { defaultValue: 'Pool small harvests into one buyer-ready lot' })}
        description={t('builder.description', {
          defaultValue: 'Set the crop, grade and collection point. MandiMate proposes compatible farms by distance, freshness and quality — you adjust, then ask each farmer to consent.',
        })}
        breadcrumbs={[{ label: t('crumbs.lots', { defaultValue: 'Lots' }), to: '/app/coordinator/lots' }, { label: t('builder.eyebrow', { defaultValue: 'Lot builder' }) }]}
      />

      <div className="grid gap-8 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* ───────────── Criteria ───────────── */}
        <Card className="h-fit xl:sticky xl:top-24">
          <form onSubmit={onPreview} noValidate className="space-y-6 p-5 sm:p-6" aria-labelledby="criteria-title">
            <div>
              <p className="eyebrow eyebrow-rule">{t('builder.criteriaEyebrow', { defaultValue: 'Step 1' })}</p>
              <h2 id="criteria-title" className="font-display text-h2 font-bold text-ink">
                {t('builder.criteria', { defaultValue: 'Criteria' })}
              </h2>
            </div>

            <Field
              label={t('builder.demand', { defaultValue: 'Open buyer demand' })}
              hint={t('builder.demandHint', { defaultValue: 'Optional — pre-fills crop, grade, quantity and pickup date' })}
              optional
            >
              <Select value={values.demand_id} onChange={(event) => applyDemand(event.target.value)} disabled={demands.isPending}>
                <option value="">{t('builder.noDemand', { defaultValue: 'No demand — build speculatively' })}</option>
                {demands.data?.map((demand) => (
                  <option key={demand.id} value={demand.id}>
                    {demand.buyer_name} · {demand.crop_name} {demand.grade_required} · {formatNumber(demand.quantity_kg)} kg ·{' '}
                    {formatDate(demand.needed_by)}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
              <Field label={t('builder.crop', { defaultValue: 'Crop' })} error={errors.crop_id?.message} required>
                <Select {...register('crop_id')} disabled={crops.isPending}>
                  {crops.isPending ? <option value="">{t('builder.loading', { defaultValue: 'Loading…' })}</option> : null}
                  {crops.data?.map((crop) => (
                    <option key={crop.id} value={crop.id}>
                      {crop.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('builder.grade', { defaultValue: 'Grade' })} error={errors.grade?.message} required>
                <Select {...register('grade')}>
                  {gradeOptions.map((grade) => (
                    <option key={grade} value={grade}>
                      {grade}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t('builder.target', { defaultValue: 'Target quantity' })} error={errors.target_quantity_kg?.message} required>
                <Input inputMode="decimal" trailing="kg" autoComplete="off" {...register('target_quantity_kg')} />
              </Field>
              <Field label={t('builder.pickupDate', { defaultValue: 'Pickup date' })} error={errors.pickup_date?.message} required>
                <Input type="date" min={todayIST()} {...register('pickup_date')} />
              </Field>
            </div>

            <fieldset className="space-y-3">
              <legend className="text-[13px] font-semibold text-ink">{t('builder.collectionPoint', { defaultValue: 'Collection point' })}</legend>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('builder.presets', { defaultValue: 'Collection point presets' })}>
                {PRESETS.map((preset) => {
                  const active = values.collection_point_name === preset.name;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => choosePreset(preset)}
                      className={cn(
                        'rounded-sm border px-3 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-gold-700',
                        active ? 'border-forest-600 bg-forest-600 text-white' : 'border-line bg-paper text-ink-2 hover:border-forest-400',
                      )}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <Field label={t('builder.pointName', { defaultValue: 'Name' })} error={errors.collection_point_name?.message} required>
                <Input autoComplete="off" {...register('collection_point_name')} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('builder.lat', { defaultValue: 'Latitude' })} error={errors.collection_latitude?.message} required>
                  <Input inputMode="decimal" autoComplete="off" {...register('collection_latitude')} />
                </Field>
                <Field label={t('builder.lng', { defaultValue: 'Longitude' })} error={errors.collection_longitude?.message} required>
                  <Input inputMode="decimal" autoComplete="off" {...register('collection_longitude')} />
                </Field>
              </div>
            </fieldset>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <label htmlFor="radius" className="text-[13px] font-semibold text-ink">
                  {t('builder.radius', { defaultValue: 'Search radius' })}
                </label>
                <span className="font-display text-h3 font-bold tabular-nums text-ink">{values.radius_km} km</span>
              </div>
              <input
                id="radius"
                type="range"
                min={MIN_RADIUS_KM}
                max={MAX_RADIUS_KM}
                step={5}
                className="w-full accent-[var(--color-forest-700)]"
                aria-valuetext={`${values.radius_km} km`}
                {...register('radius_km')}
              />
              <div className="flex justify-between text-micro text-muted">
                <span>{MIN_RADIUS_KM} km</span>
                <span>{MAX_RADIUS_KM} km</span>
              </div>
            </div>

            <Switch
              checked={values.include_ungraded}
              onCheckedChange={(checked) => setValue('include_ungraded', checked)}
              label={t('builder.ungraded', { defaultValue: 'Include ungraded listings' })}
              description={t('builder.ungradedHint', { defaultValue: 'Flagged — inspection required before pickup' })}
            />

            <Button type="submit" fullWidth size="lg" loading={preview.isPending} leadingIcon={<Wand2 strokeWidth={1.25} aria-hidden="true" />}>
              {proposal ? t('builder.refresh', { defaultValue: 'Refresh match' }) : t('builder.preview', { defaultValue: 'Preview match' })}
            </Button>
          </form>
        </Card>

        {/* ───────────── Proposal ───────────── */}
        <div className="min-w-0 space-y-8" aria-live="polite">
          {!proposal ? (
            <EmptyState
              framed
              icon={<Combine strokeWidth={1.25} aria-hidden="true" />}
              title={t('builder.emptyTitle', { defaultValue: 'No match yet' })}
              description={t('builder.emptyBody', {
                defaultValue: 'Set the criteria and preview. You will see the farms MandiMate would pool, the ones it left out and why, and whether the lot reaches its target.',
              })}
            />
          ) : (
            <>
              {stale ? (
                <p role="status" className="rounded-sm border border-gold-700/40 px-4 py-3 text-small text-ink">
                  {t('builder.stale', { defaultValue: 'Criteria changed since this preview. Refresh the match before creating the lot.' })}
                </p>
              ) : null}

              <Reveal>
                <Card variant="dark" className="overflow-hidden">
                  <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="eyebrow eyebrow-rule text-gold-400">{t('builder.feasibility', { defaultValue: 'Feasibility' })}</p>
                        <GradeBadge grade={proposal.grade} size="sm" />
                        <Badge tone={feasible ? 'success' : 'warning'} size="sm">
                          {feasible ? t('builder.feasible', { defaultValue: 'Reaches target' }) : t('builder.short', { defaultValue: 'Short of target' })}
                        </Badge>
                      </div>
                      <p className="font-display text-display-sm font-bold text-ivory">
                        <Quantity kg={total} size="xl" />{' '}
                        <span className="text-h3 text-ivory/60">
                          / {formatNumber(proposal.target_quantity_kg)} kg {proposal.crop_name}
                        </span>
                      </p>
                      <Progress
                        value={pct}
                        tone={feasible ? 'gold' : 'warning'}
                        label={t('builder.progressLabel', { defaultValue: 'Share of target pooled' })}
                        valueText={`${Math.round(pct)}%`}
                      />
                      <p className="text-small text-ivory/70">
                        {shortfall > 0
                          ? t('builder.shortfall', {
                              defaultValue: 'Shortfall {{kg}} kg · minimum to proceed {{min}} kg',
                              kg: formatNumber(shortfall, { maxDecimals: 1 }),
                              min: formatNumber(threshold, { maxDecimals: 1 }),
                            })
                          : t('builder.full', { defaultValue: 'Target fully covered' })}
                        {route && route.stops.length > 0
                          ? ` · ${t('builder.roadKm', { defaultValue: '≈ {{km}} km pickup route', km: formatNumber(route.roadKm, { maxDecimals: 1 }) })}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-ivory">
                        <dt className="text-[13px] font-semibold text-ivory/60">{t('builder.farmers', { defaultValue: 'Farmers' })}</dt>
                        <dt className="text-[13px] font-semibold text-ivory/60">{t('builder.pickup', { defaultValue: 'Pickup' })}</dt>
                        <dd className="font-display text-h2 font-bold">{members.length}</dd>
                        <dd className="font-display text-h3 font-bold">{formatDate(proposal.pickup_date)}</dd>
                      </dl>
                      <Button
                        variant="inverse"
                        size="lg"
                        onClick={onCreate}
                        loading={createLot.isPending}
                        disabled={members.length === 0 || stale}
                        leadingIcon={<Target strokeWidth={1.25} aria-hidden="true" />}
                      >
                        {t('builder.create', { defaultValue: 'Create lot & ask consent' })}
                      </Button>
                    </div>
                  </div>
                </Card>
              </Reveal>

              {route && route.stops.length > 0 ? (
                <SectionCard
                  eyebrow={<MapPinned strokeWidth={1.25} aria-hidden="true" className="size-4" />}
                  title={t('builder.mapTitle', { defaultValue: 'Farms on the route' })}
                  description={t('builder.mapBody', { defaultValue: 'Pickup order starts at the farthest farm and ends at the collection point.' })}
                >
                  <RouteMap
                    stops={route.stops}
                    destination={{ name: previewedWith?.name ?? '', latitude: proposal.collection_latitude, longitude: proposal.collection_longitude }}
                    totalDistanceKm={route.roadKm}
                    showLegend
                  />
                </SectionCard>
              ) : null}

              <SectionCard
                title={t('builder.selected', { defaultValue: 'Selected farms' })}
                description={t('builder.selectedBody', { defaultValue: 'Adjust kilograms per farm (never more than they have) or switch a farm off.' })}
                action={<Badge tone="forest">{selected.length}</Badge>}
              >
                {selected.length === 0 ? (
                  <p className="text-small text-muted">{t('builder.noneSelected', { defaultValue: 'No farms selected. Switch on a compatible farm below.' })}</p>
                ) : (
                  <ul className="space-y-3">
                    {selected.map((candidate) => (
                      <CandidateRow
                        key={candidate.harvest_id}
                        candidate={candidate}
                        entry={allocation[candidate.harvest_id]}
                        stopNumber={route?.order.get(candidate.harvest_id)}
                        onToggle={(on) => toggle(candidate.harvest_id, on)}
                        onKgChange={(kg) => setKg(candidate.harvest_id, kg)}
                      />
                    ))}
                  </ul>
                )}
              </SectionCard>

              {unselected.length > 0 ? (
                <SectionCard
                  title={t('builder.compatible', { defaultValue: 'Compatible, not selected' })}
                  description={t('builder.compatibleBody', { defaultValue: 'These farms fit the criteria but were not needed to reach the target.' })}
                  action={<Badge tone="neutral">{unselected.length}</Badge>}
                >
                  <ul className="space-y-3">
                    {unselected.map((candidate) => (
                      <CandidateRow
                        key={candidate.harvest_id}
                        candidate={candidate}
                        entry={allocation[candidate.harvest_id]}
                        onToggle={(on) => toggle(candidate.harvest_id, on)}
                        onKgChange={(kg) => setKg(candidate.harvest_id, kg)}
                      />
                    ))}
                  </ul>
                </SectionCard>
              ) : null}

              {proposal.excluded.length > 0 ? (
                <SectionCard
                  eyebrow={<Ban strokeWidth={1.25} aria-hidden="true" className="size-4" />}
                  title={t('builder.excluded', { defaultValue: 'Left out, and why' })}
                  action={<Badge tone="neutral">{proposal.excluded.length}</Badge>}
                >
                  <ul className="divide-y divide-line">
                    {proposal.excluded.map((item) => (
                      <li key={item.harvest_id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                        <span className="font-display text-lg text-ink">{item.farmer_name}</span>
                        <span className="text-small text-muted sm:text-end">{item.reason}</span>
                      </li>
                    ))}
                  </ul>
                </SectionCard>
              ) : null}

              <SectionCard
                eyebrow={<ScrollText strokeWidth={1.25} aria-hidden="true" className="size-4" />}
                title={t('builder.rules', { defaultValue: 'How this lot was matched' })}
                action={
                  <Button
                    size="sm"
                    variant="secondary"
                    leadingIcon={<Sparkles strokeWidth={1.25} aria-hidden="true" />}
                    loading={explain.isPending}
                    onClick={() =>
                      edited &&
                      explain.mutate(edited, {
                        onError: (error) => toast.error(errorMessage(error)),
                      })
                    }
                  >
                    {t('builder.explainAi', { defaultValue: 'Explain with AI' })}
                  </Button>
                }
              >
                <div className="space-y-5">
                  {proposal.explanation ? <p className="text-body font-normal leading-relaxed text-ink-2">{proposal.explanation}</p> : null}
                  {proposal.rules_applied.length > 0 ? (
                    <ol className="divide-y divide-line border-y border-line">
                      {proposal.rules_applied.map((rule, index) => (
                        <li key={rule} className="flex gap-4 py-3 text-small text-ink-2">
                          <span className="font-display text-base font-bold not-italic tabular-nums text-gold-700">{String(index + 1).padStart(2, '0')}</span>
                          <span>{rule}</span>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {explain.data || explain.isPending ? (
                    <AiPanel
                      ai={explain.data}
                      loading={explain.isPending}
                      title={t('builder.aiTitle', { defaultValue: 'In plain words' })}
                      onRegenerate={() => edited && explain.mutate(edited)}
                    />
                  ) : null}
                  {selectedDemand && selectedDemand.target_price_per_kg ? (
                    <p className="text-small text-muted">
                      {t('builder.demandPrice', { defaultValue: 'Buyer’s target price' })}: <Money value={selectedDemand.target_price_per_kg} perKg size="sm" />
                    </p>
                  ) : null}
                </div>
              </SectionCard>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
