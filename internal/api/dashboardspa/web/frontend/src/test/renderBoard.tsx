import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import type { BadgeSeverity } from '../attention/compose';
import { BeadBoard } from '../components/beads/BeadBoard';
import {
  ALL_PROJECTS,
  buildBoardModel,
  type BoardData,
  type BoardFilters,
  type RigPrefix,
} from '../lib/boardModel';
import { isRouteBead } from '../lib/stageBoard';
import type { SupervisorBead } from '../supervisor/beadReads';

// One helper for every board test (B5): the model is built by B4's
// buildBoardModel, the same way the Beads page builds it.

export interface RenderBoardOptions {
  routeBeads?: SupervisorBead[];
  serviceItems?: SupervisorBead[];
  routesComplete?: boolean;
  rigs?: RigPrefix[];
  filters?: Partial<BoardFilters>;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  openGroups?: ReadonlySet<string>;
  onToggleGroup?: (key: string) => void;
  showAllHistory?: boolean;
  onToggleHistory?: () => void;
  attentionSeverity?: (id: string) => BadgeSeverity | null;
  noteOf?: (id: string) => string | null;
  nowMs?: number;
}

export function boardData(beads: SupervisorBead[], options: RenderBoardOptions = {}): BoardData {
  return {
    items: beads.filter((b) => !isRouteBead(b)),
    routeItems: [...(options.routeBeads ?? []), ...beads.filter(isRouteBead)],
    serviceItems: options.serviceItems ?? [],
    routesComplete: options.routesComplete ?? true,
  };
}

export function renderBoard(beads: SupervisorBead[], options: RenderBoardOptions = {}) {
  const onSelect = options.onSelect ?? vi.fn();
  const onToggleGroup = options.onToggleGroup ?? vi.fn();
  const onToggleHistory = options.onToggleHistory ?? vi.fn();
  const model = buildBoardModel(boardData(beads, options), options.rigs ?? [], {
    project: ALL_PROJECTS,
    search: '',
    showTests: false,
    ...options.filters,
  });
  const result = render(
    <MemoryRouter>
      <BeadBoard
        model={model}
        selectedId={options.selectedId ?? null}
        {...(options.attentionSeverity === undefined
          ? {}
          : { attentionSeverity: options.attentionSeverity })}
        {...(options.noteOf === undefined ? {} : { noteOf: options.noteOf })}
        nowMs={options.nowMs ?? Date.parse('2026-11-15T10:40:00Z')}
        onSelect={onSelect}
        openGroups={options.openGroups ?? new Set()}
        onToggleGroup={onToggleGroup}
        showAllHistory={options.showAllHistory ?? false}
        onToggleHistory={onToggleHistory}
      />
    </MemoryRouter>,
  );
  return { ...result, model, onSelect, onToggleGroup, onToggleHistory };
}
