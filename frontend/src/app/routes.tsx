import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { Route, Routes } from 'react-router';

import { AppShell } from '@/components/layout/AppShell';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { MarketingLayout } from '@/components/layout/MarketingLayout';
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage';
import LoginPage from '@/pages/auth/LoginPage';
import SignupPage from '@/pages/auth/SignupPage';
import AboutPage from '@/pages/marketing/AboutPage';
import CalculatorPage from '@/pages/marketing/CalculatorPage';
import ContactPage from '@/pages/marketing/ContactPage';
import FaqPage from '@/pages/marketing/FaqPage';
import ForBuyersPage from '@/pages/marketing/ForBuyersPage';
import ForFarmersPage from '@/pages/marketing/ForFarmersPage';
import ForFposPage from '@/pages/marketing/ForFposPage';
import ForTransportersPage from '@/pages/marketing/ForTransportersPage';
import HomePage from '@/pages/marketing/HomePage';
import HowItWorksPage from '@/pages/marketing/HowItWorksPage';
import ImpactPage from '@/pages/marketing/ImpactPage';
import PricingPage from '@/pages/marketing/PricingPage';
import PrivacyPage from '@/pages/marketing/PrivacyPage';
import TermsPage from '@/pages/marketing/TermsPage';
import NotFoundPage from '@/pages/NotFoundPage';
import type { Role } from '@/types/api';

import { GuestOnly, RequireAuth, RequireRole } from './guards';
import { PageLoader } from './PageLoader';
import { RouteErrorBoundary } from './RouteErrorBoundary';

/* ── Signed-in workspace: one lazily loaded chunk per page ─────────────────────────────────────── */

const AppIndexPage = lazy(() => import('@/pages/app/AppIndexPage'));

const NotificationsPage = lazy(() => import('@/pages/app/shared/NotificationsPage'));
const SettingsPage = lazy(() => import('@/pages/app/shared/SettingsPage'));
const DisputesPage = lazy(() => import('@/pages/app/shared/DisputesPage'));
const VerificationPage = lazy(() => import('@/pages/app/shared/VerificationPage'));

const FarmerHomePage = lazy(() => import('@/pages/app/farmer/FarmerHomePage'));
const FarmerHarvestsPage = lazy(() => import('@/pages/app/farmer/HarvestsPage'));
const FarmerNewHarvestPage = lazy(() => import('@/pages/app/farmer/NewHarvestPage'));
const FarmerHarvestDetailPage = lazy(() => import('@/pages/app/farmer/HarvestDetailPage'));
const FarmerOffersPage = lazy(() => import('@/pages/app/farmer/OffersPage'));
const FarmerOfferDetailPage = lazy(() => import('@/pages/app/farmer/OfferDetailPage'));
const FarmerLotsPage = lazy(() => import('@/pages/app/farmer/LotsPage'));
const FarmerLotDetailPage = lazy(() => import('@/pages/app/farmer/LotDetailPage'));
const FarmerSalesPage = lazy(() => import('@/pages/app/farmer/SalesPage'));
const FarmerEarningsPage = lazy(() => import('@/pages/app/farmer/EarningsPage'));
const FarmerBuyerDemandPage = lazy(() => import('@/pages/app/farmer/BuyerDemandPage'));

const BuyerHomePage = lazy(() => import('@/pages/app/buyer/BuyerHomePage'));
const BuyerDemandsPage = lazy(() => import('@/pages/app/buyer/DemandsPage'));
const BuyerNewDemandPage = lazy(() => import('@/pages/app/buyer/NewDemandPage'));
const BuyerDemandDetailPage = lazy(() => import('@/pages/app/buyer/DemandDetailPage'));
const BuyerSupplyPage = lazy(() => import('@/pages/app/buyer/SupplyPage'));
const BuyerOffersPage = lazy(() => import('@/pages/app/buyer/OffersPage'));
const BuyerNewOfferPage = lazy(() => import('@/pages/app/buyer/NewOfferPage'));
const BuyerOfferDetailPage = lazy(() => import('@/pages/app/buyer/OfferDetailPage'));
const BuyerOrdersPage = lazy(() => import('@/pages/app/buyer/OrdersPage'));
const BuyerOrderDetailPage = lazy(() => import('@/pages/app/buyer/OrderDetailPage'));
const BuyerPaymentsPage = lazy(() => import('@/pages/app/buyer/PaymentsPage'));

const TransporterHomePage = lazy(() => import('@/pages/app/transporter/TransporterHomePage'));
const TransporterRequestsPage = lazy(() => import('@/pages/app/transporter/RequestsPage'));
const TransporterRequestDetailPage = lazy(() => import('@/pages/app/transporter/RequestDetailPage'));
const TransporterTripsPage = lazy(() => import('@/pages/app/transporter/TripsPage'));
const TransporterTripDetailPage = lazy(() => import('@/pages/app/transporter/TripDetailPage'));
const TransporterVehiclesPage = lazy(() => import('@/pages/app/transporter/VehiclesPage'));

const CoordinatorHomePage = lazy(() => import('@/pages/app/coordinator/CoordinatorHomePage'));
const CoordinatorFarmersPage = lazy(() => import('@/pages/app/coordinator/FarmersPage'));
const CoordinatorRegisterFarmerPage = lazy(() => import('@/pages/app/coordinator/RegisterFarmerPage'));
const CoordinatorHarvestsPage = lazy(() => import('@/pages/app/coordinator/HarvestsPage'));
const CoordinatorAssistedListingPage = lazy(() => import('@/pages/app/coordinator/AssistedListingPage'));
const CoordinatorLotBuilderPage = lazy(() => import('@/pages/app/coordinator/LotBuilderPage'));
const CoordinatorLotsPage = lazy(() => import('@/pages/app/coordinator/LotsPage'));
const CoordinatorLotCockpitPage = lazy(() => import('@/pages/app/coordinator/LotCockpitPage'));
const CoordinatorOfferDetailPage = lazy(() => import('@/pages/app/coordinator/OfferDetailPage'));
const CoordinatorTransportPage = lazy(() => import('@/pages/app/coordinator/TransportPage'));
const CoordinatorSettlementsPage = lazy(() => import('@/pages/app/coordinator/SettlementsPage'));
const CoordinatorSettlementDetailPage = lazy(() => import('@/pages/app/coordinator/SettlementDetailPage'));
const CoordinatorDisputesPage = lazy(() => import('@/pages/app/coordinator/DisputesPage'));
const CoordinatorInsightsPage = lazy(() => import('@/pages/app/coordinator/InsightsPage'));
const CoordinatorVerificationsPage = lazy(() => import('@/pages/app/coordinator/VerificationsPage'));

const AdminHomePage = lazy(() => import('@/pages/app/admin/AdminHomePage'));
const AdminUsersPage = lazy(() => import('@/pages/app/admin/UsersPage'));
const AdminAuditLogPage = lazy(() => import('@/pages/app/admin/AuditLogPage'));

/** A lazy page inside the app shell: its own error boundary and loader keep the shell on screen. */
function page(Component: LazyExoticComponent<ComponentType>) {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Component />
      </Suspense>
    </RouteErrorBoundary>
  );
}

const FARMER: readonly Role[] = ['farmer'];
const BUYER: readonly Role[] = ['buyer'];
const TRANSPORTER: readonly Role[] = ['transporter'];
const COORDINATOR: readonly Role[] = ['coordinator'];
const ADMIN: readonly Role[] = ['admin'];
const VERIFIABLE: readonly Role[] = ['buyer', 'transporter'];

/** The complete route map of docs/ARCHITECTURE.md. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<MarketingLayout />}>
        <Route index element={<HomePage />} />
        <Route path="how-it-works" element={<HowItWorksPage />} />
        <Route path="farmers" element={<ForFarmersPage />} />
        <Route path="buyers" element={<ForBuyersPage />} />
        <Route path="transporters" element={<ForTransportersPage />} />
        <Route path="fpos" element={<ForFposPage />} />
        <Route path="calculator" element={<CalculatorPage />} />
        <Route path="pricing" element={<PricingPage />} />
        <Route path="impact" element={<ImpactPage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="faq" element={<FaqPage />} />
        <Route path="contact" element={<ContactPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
        <Route path="terms" element={<TermsPage />} />
      </Route>

      <Route element={<AuthLayout />}>
        <Route element={<GuestOnly />}>
          <Route path="login" element={<LoginPage />} />
          <Route path="signup" element={<SignupPage />} />
        </Route>
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
      </Route>

      <Route
        path="app"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={page(AppIndexPage)} />
        <Route path="notifications" element={page(NotificationsPage)} />
        <Route path="settings" element={page(SettingsPage)} />
        <Route path="disputes" element={page(DisputesPage)} />
        <Route element={<RequireRole roles={VERIFIABLE} />}>
          <Route path="verification" element={page(VerificationPage)} />
        </Route>

        <Route path="farmer" element={<RequireRole roles={FARMER} />}>
          <Route index element={page(FarmerHomePage)} />
          <Route path="harvests" element={page(FarmerHarvestsPage)} />
          <Route path="harvests/new" element={page(FarmerNewHarvestPage)} />
          <Route path="harvests/:harvestId" element={page(FarmerHarvestDetailPage)} />
          <Route path="offers" element={page(FarmerOffersPage)} />
          <Route path="offers/:offerId" element={page(FarmerOfferDetailPage)} />
          <Route path="lots" element={page(FarmerLotsPage)} />
          <Route path="lots/:lotId" element={page(FarmerLotDetailPage)} />
          <Route path="sales" element={page(FarmerSalesPage)} />
          <Route path="earnings" element={page(FarmerEarningsPage)} />
          <Route path="demand" element={page(FarmerBuyerDemandPage)} />
        </Route>

        <Route path="buyer" element={<RequireRole roles={BUYER} />}>
          <Route index element={page(BuyerHomePage)} />
          <Route path="demands" element={page(BuyerDemandsPage)} />
          <Route path="demands/new" element={page(BuyerNewDemandPage)} />
          <Route path="demands/:demandId" element={page(BuyerDemandDetailPage)} />
          <Route path="supply" element={page(BuyerSupplyPage)} />
          <Route path="offers" element={page(BuyerOffersPage)} />
          <Route path="offers/new" element={page(BuyerNewOfferPage)} />
          <Route path="offers/:offerId" element={page(BuyerOfferDetailPage)} />
          <Route path="orders" element={page(BuyerOrdersPage)} />
          <Route path="orders/:lotId" element={page(BuyerOrderDetailPage)} />
          <Route path="payments" element={page(BuyerPaymentsPage)} />
        </Route>

        <Route path="transporter" element={<RequireRole roles={TRANSPORTER} />}>
          <Route index element={page(TransporterHomePage)} />
          <Route path="requests" element={page(TransporterRequestsPage)} />
          <Route path="requests/:requestId" element={page(TransporterRequestDetailPage)} />
          <Route path="trips" element={page(TransporterTripsPage)} />
          <Route path="trips/:requestId" element={page(TransporterTripDetailPage)} />
          <Route path="vehicles" element={page(TransporterVehiclesPage)} />
        </Route>

        <Route path="coordinator" element={<RequireRole roles={COORDINATOR} />}>
          <Route index element={page(CoordinatorHomePage)} />
          <Route path="farmers" element={page(CoordinatorFarmersPage)} />
          <Route path="farmers/new" element={page(CoordinatorRegisterFarmerPage)} />
          <Route path="harvests" element={page(CoordinatorHarvestsPage)} />
          <Route path="harvests/new" element={page(CoordinatorAssistedListingPage)} />
          <Route path="lot-builder" element={page(CoordinatorLotBuilderPage)} />
          <Route path="lots" element={page(CoordinatorLotsPage)} />
          <Route path="lots/:lotId" element={page(CoordinatorLotCockpitPage)} />
          <Route path="offers/:offerId" element={page(CoordinatorOfferDetailPage)} />
          <Route path="transport" element={page(CoordinatorTransportPage)} />
          <Route path="settlements" element={page(CoordinatorSettlementsPage)} />
          <Route path="settlements/:settlementId" element={page(CoordinatorSettlementDetailPage)} />
          <Route path="disputes" element={page(CoordinatorDisputesPage)} />
          <Route path="insights" element={page(CoordinatorInsightsPage)} />
          <Route path="verifications" element={page(CoordinatorVerificationsPage)} />
        </Route>

        <Route path="admin" element={<RequireRole roles={ADMIN} />}>
          <Route index element={page(AdminHomePage)} />
          <Route path="users" element={page(AdminUsersPage)} />
          <Route path="audit" element={page(AdminAuditLogPage)} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>

      <Route element={<MarketingLayout />}>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
