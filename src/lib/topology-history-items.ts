import {
  EMPTY_AGENT_HISTORY_DETAIL,
  type AgentHistoryItem,
} from "./agent-history";

export function selectTopologyHistoryItemsForDisplay(items: AgentHistoryItem[]): AgentHistoryItem[] {
  return items.filter((item) => item.detail !== EMPTY_AGENT_HISTORY_DETAIL);
}
