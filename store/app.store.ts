import { create } from "zustand";

type AppState = {
  activeModule: "sale" | "rent" | "buyers" | "clients" | "dashboard";
  setActiveModule: (module: AppState["activeModule"]) => void;
};

export const useAppStore = create<AppState>((set) => ({
  activeModule: "dashboard",
  setActiveModule: (activeModule) => set({ activeModule })
}));
