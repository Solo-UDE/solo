import { invoke } from '@tauri-apps/api/core';

/** Check for available app updates. Returns true if an update is available. */
export const checkForUpdate = () => invoke<boolean>('check_for_update');

/** Download and install the available update, then restart the app. */
export const installUpdate = () => invoke<void>('install_update');
