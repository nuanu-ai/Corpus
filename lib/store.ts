import { create } from "zustand";
import { type UserProfile } from "./corpus-prompt";
import {
  DEFAULT_DOCUMENTS_DASHBOARD_VIEW,
  DEFAULT_FINANCE_DASHBOARD_VIEW,
  type DocumentsDashboardView,
  type FinanceDashboardView,
} from "./dashboard-navigation";

export type { DocumentsDashboardView, FinanceDashboardView };

const defaultProfile: UserProfile = {
  name: "User",
  role: "Owner",
  livingCountry: "",
  citizenship: "",
  isDigitalNomad: false,
  company: { name: "", jurisdiction: "", type: "", entityType: "", description: "" },
  revenueRange: "N/A",
  monthlyRevenue: 0,
  tools: { bankAccount: false, stripe: false, cryptoWallet: false },
};

interface CFOStore {
  // Onboarding
  onboardingComplete: boolean;
  onboardingStep: number;
  userProfile: UserProfile;
  setOnboardingStep: (step: number) => void;
  setUserProfile: (profile: Partial<UserProfile>) => void;
  completeOnboarding: () => void;

  // Dashboard
  activeFinanceDashboardView: FinanceDashboardView;
  setActiveFinanceDashboardView: (view: FinanceDashboardView) => void;
  activeDocumentsDashboardView: DocumentsDashboardView;
  setActiveDocumentsDashboardView: (view: DocumentsDashboardView) => void;

  // Jurisdiction
  showJurisdictionNavigator: boolean;
  setShowJurisdictionNavigator: (show: boolean) => void;

  // Alerts
  selectedAlertId: string | null;
  setSelectedAlertId: (id: string | null) => void;
}

export const useCFOStore = create<CFOStore>((set) => ({
  // Onboarding
  onboardingComplete: false,
  onboardingStep: 0,
  userProfile: defaultProfile,
  setOnboardingStep: (step) => set({ onboardingStep: step }),
  setUserProfile: (profile) =>
    set((state) => ({
      userProfile: { ...state.userProfile, ...profile } as UserProfile,
    })),
  completeOnboarding: () =>
    set({ onboardingComplete: true, onboardingStep: -1 }),

  // Dashboard
  activeFinanceDashboardView: DEFAULT_FINANCE_DASHBOARD_VIEW,
  setActiveFinanceDashboardView: (view) => set({ activeFinanceDashboardView: view }),
  activeDocumentsDashboardView: DEFAULT_DOCUMENTS_DASHBOARD_VIEW,
  setActiveDocumentsDashboardView: (view) => set({ activeDocumentsDashboardView: view }),

  // Jurisdiction
  showJurisdictionNavigator: false,
  setShowJurisdictionNavigator: (show) =>
    set({ showJurisdictionNavigator: show }),

  // Alerts
  selectedAlertId: null,
  setSelectedAlertId: (id) => set({ selectedAlertId: id }),
}));
