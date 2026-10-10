import { bomUpserted, locationUpserted, partUpserted } from './catalog.ts';
import {
  inspectionApproved, inspectionDiscarded, inspectionRejected, inspectionSubmitted, inspectionVoided,
} from './inspections.ts';
import { purchaseItemReceived } from './purchasing.ts';
import type { Handler } from './types.ts';
import { workOrderDeleted, workOrderOpened, workOrderStageChanged } from './workOrders.ts';

export const handlers: Record<string, Handler> = {
  'part.upserted': partUpserted,
  'location.upserted': locationUpserted,
  'bom.upserted': bomUpserted,
  'work_order.opened': workOrderOpened,
  'work_order.stage_changed': workOrderStageChanged,
  'work_order.deleted': workOrderDeleted,
  'inspection.submitted': inspectionSubmitted,
  'inspection.approved': inspectionApproved,
  'inspection.rejected': inspectionRejected,
  'inspection.discarded': inspectionDiscarded,
  'inspection.voided': inspectionVoided,
  'purchase.item_received': purchaseItemReceived,
};
