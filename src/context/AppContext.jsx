import { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { sampleStores, sampleZones, processStoresFromCsv, storesToCsv } from '../data/sampleData';
import { fetchStoresCsv, saveStoresCsv, fetchAlertsCsv, saveAlertsCsv, fetchSchedulesJson, saveSchedulesJson, getToken } from '../services/githubService';
import { parseAlertsCsv, alertsToCsv, matchAlertToStore, fetchAlertEmails, isGmailConnected } from '../services/gmailAlertService';

const AppContext = createContext();

const initialState = {
  stores: sampleStores,
  zones: sampleZones,
  selectedStore: null,
  selectedZone: null,
  selectedSubZone: null,
  sidebarTab: 'stores',
  searchTerm: '',
  filterRegion: 'all',
  filterType: 'all',
  filterRoute: 'all',
  mapCenter: [39.0, -76.8],
  mapZoom: 8,
  syncStatus: 'idle', // idle | loading | saving | saved | error
  syncError: null,
  alerts: [],
  alertSyncStatus: 'idle', // idle | loading | saving | saved | error
  alertSyncError: null,
  schedules: {}, // { "route_weekOf": { monday: [...], ... } }
};

const easternShoreSubsections = {
  'Chestertown': 'Upper Shore',
  'Centerville': 'Upper Shore',
  'Millington': 'Upper Shore',
  'Stevensville': 'Upper Shore',
  'Denton': 'Upper Shore',
  'Easton': 'Mid Shore',
  'Cambridge': 'Mid Shore',
  'Federalsburg': 'Mid Shore',
  'MD': 'Mid Shore',
  'Salisbury': 'Lower Shore',
  'SALISBURY': 'Lower Shore',
  'Fruitland': 'Lower Shore',
  'Princess Anne': 'Lower Shore',
  'Crisfield': 'Lower Shore',
  'Ocean City': 'Ocean City & Coastal',
  'Berlin': 'Ocean City & Coastal',
  'BERLIN': 'Ocean City & Coastal',
  'Dover': 'Dover Area',
};

function reassignStores(stores, zones) {
  return stores.map((store) => {
    const zone = zones.find((z) => z.name === store.region);
    if (zone) {
      let subZone;
      if (store.region === 'Eastern Shore Maryland') {
        const subsection = easternShoreSubsections[store.territory] || 'Lower Shore';
        subZone = zone.subZones.find((sz) => sz.name === subsection);
      } else {
        subZone = zone.subZones.find((sz) => sz.name === store.territory);
      }
      return {
        ...store,
        zoneId: zone.id,
        subZoneId: subZone ? subZone.id : null,
      };
    }
    return { ...store, zoneId: null, subZoneId: null };
  });
}

function reducer(state, action) {
  switch (action.type) {
    case 'LOAD_FROM_GITHUB': {
      const { stores, zones } = action.payload;
      return { ...state, stores, zones, syncStatus: 'saved', syncError: null };
    }
    case 'SET_SYNC_STATUS':
      return { ...state, syncStatus: action.payload.status, syncError: action.payload.error || null };
    case 'ADD_STORE': {
      const newStore = { id: uuidv4(), ...action.payload };
      const updatedStores = [...state.stores, newStore];
      return { ...state, stores: reassignStores(updatedStores, state.zones), syncStatus: 'idle' };
    }
    case 'UPDATE_STORE': {
      const updatedStores = state.stores.map((s) =>
        s.id === action.payload.id ? { ...s, ...action.payload } : s
      );
      return { ...state, stores: reassignStores(updatedStores, state.zones), syncStatus: 'idle' };
    }
    case 'BULK_IMPORT_STORES': {
      const { updates, additions } = action.payload;
      let updatedStores = [...state.stores];
      // Apply updates to existing stores
      const updateMap = {};
      updates.forEach(u => { updateMap[u.id] = u; });
      updatedStores = updatedStores.map(s =>
        updateMap[s.id] ? { ...s, ...updateMap[s.id] } : s
      );
      // Add new stores
      additions.forEach(a => { updatedStores.push(a); });
      return { ...state, stores: reassignStores(updatedStores, state.zones), syncStatus: 'idle' };
    }
    case 'DELETE_STORE':
      return {
        ...state,
        stores: state.stores.filter((s) => s.id !== action.payload),
        selectedStore:
          state.selectedStore === action.payload ? null : state.selectedStore,
        syncStatus: 'idle',
      };
    case 'ADD_ZONE': {
      const newZone = { id: uuidv4(), subZones: [], ...action.payload };
      const newZones = [...state.zones, newZone];
      return {
        ...state,
        zones: newZones,
        stores: reassignStores(state.stores, newZones),
      };
    }
    case 'UPDATE_ZONE': {
      const newZones = state.zones.map((z) =>
        z.id === action.payload.id ? { ...z, ...action.payload } : z
      );
      return {
        ...state,
        zones: newZones,
        stores: reassignStores(state.stores, newZones),
      };
    }
    case 'DELETE_ZONE': {
      const newZones = state.zones.filter((z) => z.id !== action.payload);
      return {
        ...state,
        zones: newZones,
        stores: reassignStores(state.stores, newZones),
        selectedZone:
          state.selectedZone === action.payload ? null : state.selectedZone,
      };
    }
    case 'ADD_SUBZONE': {
      const { zoneId, subZone } = action.payload;
      const newSubZone = { id: uuidv4(), ...subZone };
      const newZones = state.zones.map((z) =>
        z.id === zoneId
          ? { ...z, subZones: [...z.subZones, newSubZone] }
          : z
      );
      return {
        ...state,
        zones: newZones,
        stores: reassignStores(state.stores, newZones),
      };
    }
    case 'UPDATE_SUBZONE': {
      const { zoneId, subZone } = action.payload;
      const newZones = state.zones.map((z) =>
        z.id === zoneId
          ? {
              ...z,
              subZones: z.subZones.map((sz) =>
                sz.id === subZone.id ? { ...sz, ...subZone } : sz
              ),
            }
          : z
      );
      return {
        ...state,
        zones: newZones,
        stores: reassignStores(state.stores, newZones),
      };
    }
    case 'DELETE_SUBZONE': {
      const { zoneId, subZoneId } = action.payload;
      const newZones = state.zones.map((z) =>
        z.id === zoneId
          ? { ...z, subZones: z.subZones.filter((sz) => sz.id !== subZoneId) }
          : z
      );
      return {
        ...state,
        zones: newZones,
        stores: reassignStores(state.stores, newZones),
        selectedSubZone:
          state.selectedSubZone === subZoneId ? null : state.selectedSubZone,
      };
    }
    case 'SELECT_STORE':
      return { ...state, selectedStore: action.payload };
    case 'SELECT_ZONE':
      return { ...state, selectedZone: action.payload, selectedSubZone: null };
    case 'SELECT_SUBZONE':
      return { ...state, selectedSubZone: action.payload };
    case 'SET_SIDEBAR_TAB':
      return { ...state, sidebarTab: action.payload };
    case 'SET_SEARCH':
      return { ...state, searchTerm: action.payload };
    case 'SET_FILTER_REGION':
      return { ...state, filterRegion: action.payload };
    case 'SET_FILTER_TYPE':
      return { ...state, filterType: action.payload };
    case 'SET_FILTER_ROUTE':
      return { ...state, filterRoute: action.payload };
    case 'SET_MAP_VIEW':
      return {
        ...state,
        mapCenter: action.payload.center,
        mapZoom: action.payload.zoom,
      };
    case 'LOAD_ALERTS':
      return { ...state, alerts: action.payload, alertSyncStatus: 'saved', alertSyncError: null };
    case 'SET_ALERTS':
      return { ...state, alerts: action.payload, alertSyncStatus: 'idle' };
    case 'SET_ALERT_SYNC_STATUS':
      return { ...state, alertSyncStatus: action.payload.status, alertSyncError: action.payload.error || null };
    case 'LOAD_SCHEDULES':
      return { ...state, schedules: action.payload };
    case 'SET_SCHEDULE': {
      const { key, schedule } = action.payload;
      return { ...state, schedules: { ...state.schedules, [key]: schedule } };
    }
    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const saveTimer = useRef(null);
  const prevStoresRef = useRef(state.stores);

  // Load from GitHub on mount if token is configured
  useEffect(() => {
    if (!getToken()) return;
    dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'loading' } });
    fetchStoresCsv()
      .then(({ content }) => {
        const { stores, zones } = processStoresFromCsv(content);
        dispatch({ type: 'LOAD_FROM_GITHUB', payload: { stores, zones } });
      })
      .catch((err) => {
        console.error('Failed to load from GitHub:', err);
        dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'error', error: err.message } });
      });
  }, []);

  // Auto-save to GitHub when stores change (debounced 2s)
  useEffect(() => {
    if (!getToken()) return;
    if (state.syncStatus === 'loading') return;
    // Skip if stores haven't actually changed (initial load, etc.)
    if (prevStoresRef.current === state.stores) return;
    prevStoresRef.current = state.stores;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'saving' } });
      const csv = storesToCsv(state.stores);
      saveStoresCsv(csv)
        .then(() => {
          dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'saved' } });
        })
        .catch((err) => {
          console.error('Failed to save to GitHub:', err);
          dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'error', error: err.message } });
        });
    }, 2000);

    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [state.stores, state.syncStatus]);

  // Manual sync trigger
  const syncFromGithub = useCallback(() => {
    if (!getToken()) return;
    dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'loading' } });
    fetchStoresCsv()
      .then(({ content }) => {
        const { stores, zones } = processStoresFromCsv(content);
        dispatch({ type: 'LOAD_FROM_GITHUB', payload: { stores, zones } });
      })
      .catch((err) => {
        dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'error', error: err.message } });
      });
  }, []);

  const saveToGithub = useCallback(() => {
    if (!getToken()) return;
    dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'saving' } });
    const csv = storesToCsv(state.stores);
    saveStoresCsv(csv)
      .then(() => {
        dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'saved' } });
      })
      .catch((err) => {
        dispatch({ type: 'SET_SYNC_STATUS', payload: { status: 'error', error: err.message } });
      });
  }, [state.stores]);

  // Load alerts from GitHub on mount
  useEffect(() => {
    if (!getToken()) return;
    fetchAlertsCsv()
      .then(({ content }) => {
        if (content) {
          const alerts = parseAlertsCsv(content);
          dispatch({ type: 'LOAD_ALERTS', payload: alerts });
        }
      })
      .catch((err) => {
        console.error('Failed to load alerts:', err);
      });
  }, []);

  // Auto-save alerts to GitHub when they change
  const prevAlertsRef = useRef(state.alerts);
  useEffect(() => {
    if (!getToken()) return;
    if (prevAlertsRef.current === state.alerts) return;
    prevAlertsRef.current = state.alerts;
    if (state.alerts.length === 0) return;

    dispatch({ type: 'SET_ALERT_SYNC_STATUS', payload: { status: 'saving' } });
    const csv = alertsToCsv(state.alerts);
    saveAlertsCsv(csv)
      .then(() => {
        dispatch({ type: 'SET_ALERT_SYNC_STATUS', payload: { status: 'saved' } });
      })
      .catch((err) => {
        console.error('Failed to save alerts:', err);
        dispatch({ type: 'SET_ALERT_SYNC_STATUS', payload: { status: 'error', error: err.message } });
      });
  }, [state.alerts]);

  // Fetch new alerts from Gmail and merge with existing
  const fetchGmailAlerts = useCallback(async () => {
    if (!isGmailConnected()) throw new Error('Not connected to Gmail');
    dispatch({ type: 'SET_ALERT_SYNC_STATUS', payload: { status: 'loading' } });

    try {
      // Find the most recent alert date to only fetch new ones
      const existingDates = state.alerts.map(a => a.dateReceived).filter(Boolean).sort();
      const afterDate = existingDates.length > 0 ? existingDates[existingDates.length - 1] : undefined;

      const newAlerts = await fetchAlertEmails(afterDate);

      // Deduplicate by refNumber
      const existingRefs = new Set(state.alerts.map(a => a.refNumber));
      const uniqueNew = newAlerts.filter(a => !existingRefs.has(a.refNumber));

      // Match each new alert to a store
      uniqueNew.forEach(alert => {
        const store = matchAlertToStore(alert, state.stores);
        if (store) {
          alert.storeId = store.id;
          alert.routeNumber = store.routeNumber || '';
        }
      });

      if (uniqueNew.length > 0) {
        const merged = [...state.alerts, ...uniqueNew];
        dispatch({ type: 'SET_ALERTS', payload: merged });
      } else {
        dispatch({ type: 'SET_ALERT_SYNC_STATUS', payload: { status: 'saved' } });
      }

      return uniqueNew.length;
    } catch (err) {
      dispatch({ type: 'SET_ALERT_SYNC_STATUS', payload: { status: 'error', error: err.message } });
      throw err;
    }
  }, [state.alerts, state.stores]);

  const syncAlertsFromGithub = useCallback(() => {
    if (!getToken()) return;
    dispatch({ type: 'SET_ALERT_SYNC_STATUS', payload: { status: 'loading' } });
    fetchAlertsCsv()
      .then(({ content }) => {
        if (content) {
          const alerts = parseAlertsCsv(content);
          dispatch({ type: 'LOAD_ALERTS', payload: alerts });
        } else {
          dispatch({ type: 'SET_ALERT_SYNC_STATUS', payload: { status: 'saved' } });
        }
      })
      .catch((err) => {
        dispatch({ type: 'SET_ALERT_SYNC_STATUS', payload: { status: 'error', error: err.message } });
      });
  }, []);

  // Load schedules from GitHub on mount
  useEffect(() => {
    if (!getToken()) return;
    fetchSchedulesJson()
      .then(({ content }) => {
        try {
          const data = JSON.parse(content);
          dispatch({ type: 'LOAD_SCHEDULES', payload: data });
        } catch { /* empty or invalid */ }
      })
      .catch((err) => {
        console.error('Failed to load schedules:', err);
      });
  }, []);

  // Save schedule to GitHub
  const saveSchedule = useCallback((key, scheduleData) => {
    dispatch({ type: 'SET_SCHEDULE', payload: { key, schedule: scheduleData } });
  }, []);

  // Auto-save schedules to GitHub when they change
  const prevSchedulesRef = useRef(state.schedules);
  const schedulesSaveTimer = useRef(null);
  useEffect(() => {
    if (!getToken()) return;
    if (prevSchedulesRef.current === state.schedules) return;
    prevSchedulesRef.current = state.schedules;
    if (Object.keys(state.schedules).length === 0) return;

    if (schedulesSaveTimer.current) clearTimeout(schedulesSaveTimer.current);
    schedulesSaveTimer.current = setTimeout(() => {
      saveSchedulesJson(JSON.stringify(state.schedules))
        .catch((err) => console.error('Failed to save schedules:', err));
    }, 2000);

    return () => { if (schedulesSaveTimer.current) clearTimeout(schedulesSaveTimer.current); };
  }, [state.schedules]);

  const actions = {
    addStore: useCallback(
      (store) => dispatch({ type: 'ADD_STORE', payload: store }),
      []
    ),
    updateStore: useCallback(
      (store) => dispatch({ type: 'UPDATE_STORE', payload: store }),
      []
    ),
    deleteStore: useCallback(
      (id) => dispatch({ type: 'DELETE_STORE', payload: id }),
      []
    ),
    addZone: useCallback(
      (zone) => dispatch({ type: 'ADD_ZONE', payload: zone }),
      []
    ),
    updateZone: useCallback(
      (zone) => dispatch({ type: 'UPDATE_ZONE', payload: zone }),
      []
    ),
    deleteZone: useCallback(
      (id) => dispatch({ type: 'DELETE_ZONE', payload: id }),
      []
    ),
    addSubZone: useCallback(
      (zoneId, subZone) =>
        dispatch({ type: 'ADD_SUBZONE', payload: { zoneId, subZone } }),
      []
    ),
    updateSubZone: useCallback(
      (zoneId, subZone) =>
        dispatch({ type: 'UPDATE_SUBZONE', payload: { zoneId, subZone } }),
      []
    ),
    deleteSubZone: useCallback(
      (zoneId, subZoneId) =>
        dispatch({ type: 'DELETE_SUBZONE', payload: { zoneId, subZoneId } }),
      []
    ),
    selectStore: useCallback(
      (id) => dispatch({ type: 'SELECT_STORE', payload: id }),
      []
    ),
    selectZone: useCallback(
      (id) => dispatch({ type: 'SELECT_ZONE', payload: id }),
      []
    ),
    selectSubZone: useCallback(
      (id) => dispatch({ type: 'SELECT_SUBZONE', payload: id }),
      []
    ),
    setSidebarTab: useCallback(
      (tab) => dispatch({ type: 'SET_SIDEBAR_TAB', payload: tab }),
      []
    ),
    setSearch: useCallback(
      (term) => dispatch({ type: 'SET_SEARCH', payload: term }),
      []
    ),
    setFilterRegion: useCallback(
      (region) => dispatch({ type: 'SET_FILTER_REGION', payload: region }),
      []
    ),
    setFilterType: useCallback(
      (type) => dispatch({ type: 'SET_FILTER_TYPE', payload: type }),
      []
    ),
    setFilterRoute: useCallback(
      (route) => dispatch({ type: 'SET_FILTER_ROUTE', payload: route }),
      []
    ),
    setMapView: useCallback(
      (center, zoom) =>
        dispatch({ type: 'SET_MAP_VIEW', payload: { center, zoom } }),
      []
    ),
    syncFromGithub,
    saveToGithub,
    fetchGmailAlerts,
    syncAlertsFromGithub,
    saveSchedule,
    bulkImportStores: useCallback(
      (updates, additions) => dispatch({ type: 'BULK_IMPORT_STORES', payload: { updates, additions } }),
      []
    ),
  };

  return (
    <AppContext.Provider value={{ state, ...actions }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
