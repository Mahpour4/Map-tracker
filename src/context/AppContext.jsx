import { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { sampleStores, sampleZones, processStoresFromCsv, storesToCsv } from '../data/sampleData';
import { fetchStoresCsv, saveStoresCsv, fetchAlertsCsv, saveAlertsCsv, fetchSchedulesJson, saveSchedulesJson, fetchImportLog, saveImportLog, getToken } from '../services/githubService';
import { parseAlertsCsv, alertsToCsv, matchAlertToStore, fetchAlertEmails, isGmailConnected, fetchAlertImage as fetchAlertImageApi, labelAlertMessages } from '../services/gmailAlertService';

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
  currentPage: 'map',
  syncStatus: 'idle', // idle | loading | saving | saved | error
  syncError: null,
  alerts: [],
  alertSyncStatus: 'idle', // idle | loading | saving | saved | error
  alertSyncError: null,
  alertImages: {}, // { emailId: { dataUri, filename, loading, error } } — memory-only
  importLog: [], // Array of import entries, newest first
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
      // Apply updates to existing stores (strip display-only fields)
      const updateMap = {};
      updates.forEach(u => {
        const { _displayName, ...clean } = u;
        updateMap[clean.id] = clean;
      });
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
    case 'SET_PAGE':
      return { ...state, currentPage: action.payload };
    case 'LOAD_ALERTS':
      return { ...state, alerts: action.payload, alertSyncStatus: 'saved', alertSyncError: null };
    case 'SET_ALERTS':
      return { ...state, alerts: action.payload, alertSyncStatus: 'idle' };
    case 'SET_ALERT_SYNC_STATUS':
      return { ...state, alertSyncStatus: action.payload.status, alertSyncError: action.payload.error || null };
    case 'SET_ALERT_IMAGE': {
      const { emailId, ...imageData } = action.payload;
      return { ...state, alertImages: { ...state.alertImages, [emailId]: imageData } };
    }
    case 'LOAD_IMPORT_LOG':
      return { ...state, importLog: action.payload };
    case 'ADD_IMPORT_ENTRY':
      return { ...state, importLog: [action.payload, ...state.importLog] };
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
        // Update ref BEFORE dispatch so auto-save effect sees no change
        prevStoresRef.current = stores;
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

  // Load alerts from GitHub on mount (skip if file has never been saved)
  useEffect(() => {
    if (!getToken()) return;
    // If we've never saved alerts, the file doesn't exist yet — skip the fetch
    // to avoid a 404 console error. Alerts will be created on first Gmail fetch.
    if (!localStorage.getItem('github_alerts_sha')) return;
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

  // Fetch new alerts from Gmail — merges with existing, dedupes by refNumber, prunes >30 days
  // @param {string} [date] - YYYY-MM-DD date to fetch alerts for (defaults to today)
  // Returns { newCount, rawMessages } for debug display
  const fetchGmailAlerts = useCallback(async (date) => {
    if (!isGmailConnected()) throw new Error('Not connected to Gmail');

    dispatch({ type: 'SET_ALERT_SYNC_STATUS', payload: { status: 'loading' } });

    try {
      const afterDate = date || new Date().toISOString().split('T')[0];

      const { alerts: newAlerts, rawMessages } = await fetchAlertEmails(afterDate);

      // Match each alert to a store
      newAlerts.forEach(alert => {
        const store = matchAlertToStore(alert, state.stores);
        if (store) {
          alert.storeId = store.id;
          alert.routeNumber = store.routeNumber || '';
        }
      });

      // Merge: existing alerts by refNumber, new overwrite duplicates
      const alertMap = {};
      state.alerts.forEach(a => { alertMap[a.refNumber] = a; });
      newAlerts.forEach(a => { alertMap[a.refNumber] = a; });

      // Prune alerts older than 30 days
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      const cutoffStr = cutoff.toISOString().split('T')[0];
      const merged = Object.values(alertMap).filter(a =>
        !a.dateReceived || a.dateReceived >= cutoffStr
      );

      dispatch({ type: 'SET_ALERTS', payload: merged });

      // Label fetched messages in Gmail (non-blocking)
      const messageIds = newAlerts.map(a => a.emailId).filter(Boolean);
      if (messageIds.length > 0) {
        labelAlertMessages(messageIds);
      }

      return { newCount: newAlerts.length, rawMessages };
    } catch (err) {
      dispatch({ type: 'SET_ALERT_SYNC_STATUS', payload: { status: 'error', error: err.message } });
      throw err;
    }
  }, [state.stores, state.alerts]);

  const loadAlertImage = useCallback(async (emailId) => {
    if (!emailId) return;
    dispatch({ type: 'SET_ALERT_IMAGE', payload: { emailId, loading: true, error: null, dataUri: null } });
    try {
      const result = await fetchAlertImageApi(emailId);
      if (result) {
        dispatch({ type: 'SET_ALERT_IMAGE', payload: { emailId, loading: false, error: null, ...result } });
      } else {
        dispatch({ type: 'SET_ALERT_IMAGE', payload: { emailId, loading: false, error: 'No image found', dataUri: null } });
      }
    } catch (err) {
      dispatch({ type: 'SET_ALERT_IMAGE', payload: { emailId, loading: false, error: err.message, dataUri: null } });
    }
  }, []);

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

  // Load import log from GitHub on mount
  useEffect(() => {
    if (!getToken()) return;
    fetchImportLog()
      .then(({ content }) => {
        try {
          const data = JSON.parse(content);
          if (Array.isArray(data)) {
            dispatch({ type: 'LOAD_IMPORT_LOG', payload: data });
          }
        } catch { /* empty or invalid */ }
      })
      .catch((err) => {
        console.error('Failed to load import log:', err);
      });
  }, []);

  const addImportEntry = useCallback((entry) => {
    dispatch({ type: 'ADD_IMPORT_ENTRY', payload: { id: uuidv4(), timestamp: new Date().toISOString(), ...entry } });
  }, []);

  // Auto-save import log to GitHub when it changes
  const prevImportLogRef = useRef(state.importLog);
  const importLogSaveTimer = useRef(null);
  useEffect(() => {
    if (!getToken()) return;
    if (prevImportLogRef.current === state.importLog) return;
    prevImportLogRef.current = state.importLog;
    if (state.importLog.length === 0) return;

    if (importLogSaveTimer.current) clearTimeout(importLogSaveTimer.current);
    importLogSaveTimer.current = setTimeout(() => {
      saveImportLog(JSON.stringify(state.importLog))
        .catch((err) => console.error('Failed to save import log:', err));
    }, 2000);

    return () => { if (importLogSaveTimer.current) clearTimeout(importLogSaveTimer.current); };
  }, [state.importLog]);

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
    setPage: useCallback(
      (page) => dispatch({ type: 'SET_PAGE', payload: page }),
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
    loadAlertImage,
    saveSchedule,
    addImportEntry,
    clearAlerts: useCallback(() => dispatch({ type: 'SET_ALERTS', payload: [] }), []),
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
