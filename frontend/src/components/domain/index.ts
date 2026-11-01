/**
 * MandiMate domain components — the building blocks every role's pages share. Strings live in the
 * `domain` namespace (enum labels are reused from `common`).
 */

/* Money & quantities */
export { Delta, Money, Quantity, useKgFormatter } from './Money';
export type { DeltaProps, MoneyProps, MoneySize, QuantityProps } from './Money';
export { ProceedsBar } from './ProceedsBar';
export type { ProceedsBarProps } from './ProceedsBar';

/* Honesty & status */
export { CERTAINTIES, CertaintyBadge, CertaintyIcon, CertaintyLegend } from './Certainty';
export type { CertaintyBadgeProps, CertaintyIconProps, CertaintyLegendProps } from './Certainty';
export { StatusBadge } from './StatusBadge';
export type { StatusBadgeProps } from './StatusBadge';
export { STATUS_TONES, statusLabelKey, statusTone } from './status';
export type { StatusKind, StatusValueMap } from './status';
export { GradeBadge } from './GradeBadge';
export type { GradeBadgeProps } from './GradeBadge';
export { QualityBadge } from './QualityBadge';
export type { QualityBadgeProps } from './QualityBadge';

/* Net proceeds & selling options */
export { NetProceedsCard, UnresolvedList } from './NetProceedsCard';
export type { NetProceedsCardProps, UnresolvedListProps } from './NetProceedsCard';
export { BreakdownDisclosure, BreakdownTable } from './BreakdownTable';
export type { BreakdownDisclosureProps, BreakdownTableProps } from './BreakdownTable';
export { SellingOptionsCompare } from './SellingOptionsCompare';
export type { SellingOptionsCompareProps } from './SellingOptionsCompare';
export { findBaseline, orderSellingOptions, proceedsShares, upliftPerKg } from './proceeds';
export type { ProceedsShares } from './proceeds';

/* Journey */
export { JOURNEY_KEYS, JourneyMeter, JourneyTimeline } from './JourneyTimeline';
export type { JourneyMeterProps, JourneyTimelineProps } from './JourneyTimeline';

/* Offers & consent */
export { OfferCard } from './OfferCard';
export type { OfferCardProps } from './OfferCard';
export { AwaitingBadge, BuyerTrust, MinPriceIndicator, ValidityCountdown, useDurationLabel } from './OfferMeta';
export type { AwaitingBadgeProps, BuyerTrustProps, MinPriceIndicatorProps, ValidityCountdownProps } from './OfferMeta';
export { NegotiationThread } from './NegotiationThread';
export type { NegotiationThreadProps } from './NegotiationThread';
export { ConsentPanel, consentFromMember, consentFromOffer, tallyConsents } from './ConsentPanel';
export type { ConsentEntry, ConsentPanelProps, ConsentTally } from './ConsentPanel';

/* Lots & supply */
export { LotCard } from './LotCard';
export type { LotCardProps } from './LotCard';
export { LotMembersTable } from './LotMembersTable';
export type { LotMembersTableProps } from './LotMembersTable';
export { SupplyCard } from './SupplyCard';
export type { SupplyCardProps } from './SupplyCard';

/* Transport */
export { RouteMap } from './RouteMap';
export type { RouteDestination, RouteMapProps, RouteMapStop } from './RouteMap';
export { TransportPlanSummary, UtilisationGauge } from './TransportPlanSummary';
export type { TransportPlanSummaryProps, UtilisationGaugeProps } from './TransportPlanSummary';
export { fitProjection, niceScale, placeLabels, polylinePath } from './routeGeometry';
export type { FitOptions, Insets, LabelPlacement, LabelRequest, LatLng, MapProjection, ScreenPoint } from './routeGeometry';

/* AI, voice & photos */
export { AiModeNotice, AiPanel, AiSourceBadge } from './AiPanel';
export type { AiModeNoticeProps, AiPanelProps, AiSourceBadgeProps } from './AiPanel';
export { VoiceCapture } from './VoiceCapture';
export type { VoiceCaptureProps } from './VoiceCapture';
export { ACCEPTED_PHOTO_TYPES, MAX_PHOTO_BYTES, PhotoUploader, validatePhoto } from './PhotoUploader';
export type { PhotoUploaderProps } from './PhotoUploader';

/* Crops */
export { CropGlyph } from './CropGlyph';
export type { CropGlyphProps } from './CropGlyph';
export { CROP_CODES, cropCodeFromLotCode, cropCodeFromName, isCropCode, resolveCropCode } from './crops';
export type { CropCode, CropReference } from './crops';

/* Page scaffolding */
export { PageHeader } from './PageHeader';
export type { Crumb, PageHeaderProps } from './PageHeader';
export { KpiStrip, StatCard } from './StatCard';
export type { KpiItem, KpiStripProps, StatCardProps } from './StatCard';
export { ActionList } from './ActionList';
export type { ActionListProps } from './ActionList';
export { ActivityFeed } from './ActivityFeed';
export type { ActivityFeedProps } from './ActivityFeed';
export { SectionCard } from './SectionCard';
export type { SectionCardProps } from './SectionCard';
export { DataTable } from './DataTable';
export type { DataTableColumn, DataTableProps } from './DataTable';
export { compareSortValues, sortRows } from './tableSort';
export type { SortDirection, SortValue } from './tableSort';
export { FilterBar } from './FilterBar';
export type { FilterBarProps } from './FilterBar';
export { ConfirmDialog } from './ConfirmDialog';
export type { ConfirmDialogProps } from './ConfirmDialog';
export { QueryState } from './QueryState';
export type { QueryEmpty, QueryLike, QuerySkeleton, QueryStateProps } from './QueryState';
export { DemoDataNotice } from './DemoDataNotice';
export type { DemoDataNoticeProps } from './DemoDataNotice';

/* Shared helpers */
export { useElementWidth, useNow, useUiLanguage } from './hooks';
export { ACTION_ICONS, ACTIVITY_ICONS } from './icons';
export { OPEN_OFFER_STATUSES, deadlineUrgency, durationParts, sortActionItems } from './schedule';
export type { DurationUnit, Urgency } from './schedule';
