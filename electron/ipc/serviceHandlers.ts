import { z } from "zod";

import * as IpcChannels from "../ipcChannels.js";
import { DesktopSchemas, handleValidatedIpc, VoidPayloadSchema } from "../ipcValidation.js";
import type { DesktopEnvironment } from "../environment.js";
import {
  listManagedServiceStatuses,
  startManagedService,
  stopManagedService,
} from "../processManager.js";
import {
  activateServiceProfile,
  checkService,
  getServiceConfig,
  isDesktopServiceId,
  listServiceProfiles,
  listServiceStatuses,
  saveCurrentServiceProfile,
  saveServiceConfig,
  type DesktopServiceId,
} from "../services.js";

const serviceIdPayload = z.custom<DesktopServiceId>(
  (value) => typeof value === "string" && isDesktopServiceId(value),
  "Unknown desktop service.",
);

export function registerServiceHandlers(environment: DesktopEnvironment) {
  handleValidatedIpc({
    channel: IpcChannels.LIST_SERVICE_STATUSES_CHANNEL,
    payload: VoidPayloadSchema,
    result: z.array(DesktopSchemas.serviceStatus),
    handler: () => listServiceStatuses(),
  });

  handleValidatedIpc({
    channel: IpcChannels.CHECK_SERVICE_CHANNEL,
    payload: serviceIdPayload,
    result: DesktopSchemas.serviceStatus,
    handler: (_event, serviceId) => checkService(serviceId),
  });

  handleValidatedIpc({
    channel: IpcChannels.GET_SERVICE_CONFIG_CHANNEL,
    payload: serviceIdPayload,
    result: DesktopSchemas.serviceConfig,
    handler: (_event, serviceId) => getServiceConfig(serviceId),
  });

  handleValidatedIpc({
    channel: IpcChannels.SAVE_SERVICE_CONFIG_CHANNEL,
    payload: DesktopSchemas.serviceConfig,
    result: DesktopSchemas.serviceConfig,
    handler: (_event, input) => saveServiceConfig(input),
  });

  handleValidatedIpc({
    channel: IpcChannels.LIST_SERVICE_PROFILES_CHANNEL,
    payload: VoidPayloadSchema,
    result: z.array(DesktopSchemas.serviceProfile),
    handler: () => listServiceProfiles(),
  });

  handleValidatedIpc({
    channel: IpcChannels.SAVE_SERVICE_PROFILE_CHANNEL,
    payload: DesktopSchemas.saveServiceProfileInput,
    result: DesktopSchemas.serviceProfile,
    handler: (_event, input) => saveCurrentServiceProfile(input),
  });

  handleValidatedIpc({
    channel: IpcChannels.ACTIVATE_SERVICE_PROFILE_CHANNEL,
    payload: z.string(),
    result: DesktopSchemas.serviceProfile,
    handler: (_event, id) => activateServiceProfile(id),
  });

  handleValidatedIpc({
    channel: IpcChannels.LIST_MANAGED_SERVICE_STATUSES_CHANNEL,
    payload: VoidPayloadSchema,
    result: z.array(DesktopSchemas.managedServiceStatus),
    handler: () => listManagedServiceStatuses(environment),
  });

  handleValidatedIpc({
    channel: IpcChannels.START_MANAGED_SERVICE_CHANNEL,
    payload: DesktopSchemas.managedServiceId,
    result: DesktopSchemas.managedServiceStatus,
    handler: (_event, serviceId) => startManagedService(environment, serviceId),
  });

  handleValidatedIpc({
    channel: IpcChannels.STOP_MANAGED_SERVICE_CHANNEL,
    payload: DesktopSchemas.managedServiceId,
    result: DesktopSchemas.managedServiceStatus,
    handler: (_event, serviceId) => stopManagedService(environment, serviceId),
  });
}
