"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { TaskStatus, TaskPriority, TaskType } from "@/types/domain";

interface BacklogFiltersProps {
  filters: {
    search: string;
    status: TaskStatus[];
    priority: TaskPriority[];
    type: TaskType[];
    assignee: string;
    awaitingAIReview: boolean;
  };
  onFiltersChange: (filters: Partial<BacklogFiltersProps["filters"]>) => void;
  assignees: Array<{ id: string; name: string }>;
}

const statusOptions: { value: TaskStatus; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "A fazer" },
  { value: "in_progress", label: "Em progresso" },
  { value: "in_review", label: "Em revisão" },
  { value: "blocked", label: "Bloqueado" },
  { value: "done", label: "Concluído" },
];

const priorityOptions: { value: TaskPriority; label: string }[] = [
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Média" },
  { value: "high", label: "Alta" },
  { value: "urgent", label: "Urgente" },
];

const typeOptions: { value: TaskType; label: string }[] = [
  { value: "epic", label: "Épico" },
  { value: "feature", label: "Feature" },
  { value: "task", label: "Tarefa" },
  { value: "bug", label: "Bug" },
  { value: "tech_debt", label: "Dívida Técnica" },
];

export function BacklogFilters({
  filters,
  onFiltersChange,
  assignees,
}: BacklogFiltersProps) {
  const [search, setSearch] = React.useState(filters.search);

  React.useEffect(() => {
    const timeout = setTimeout(() => {
      onFiltersChange({ search });
    }, 300);
    return () => clearTimeout(timeout);
  }, [search, onFiltersChange]);

  const handleMultiSelectChange = <T,>(
    current: T[],
    value: T,
    onChange: (val: T[]) => void
  ) => {
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onChange(next);
  };

  const hasActiveFilters =
    filters.status.length > 0 ||
    filters.priority.length > 0 ||
    filters.type.length > 0 ||
    filters.assignee ||
    filters.awaitingAIReview;

  return (
    <div className="flex flex-wrap items-center gap-4 p-4 bg-card border-b border-border">
      {/* Search */}
      <div className="flex-1 min-w-[200px] max-w-[400px]">
        <Input
          placeholder="Buscar tarefas..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full"
        />
      </div>

      {/* Status Filter */}
      <Select
        value={filters.status.join(",")}
        onValueChange={(value: string) =>
          onFiltersChange({ status: value ? value.split(",") as TaskStatus[] : [] })
        }
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          {statusOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Priority Filter */}
      <Select
        value={filters.priority.join(",")}
        onValueChange={(value: string) =>
          onFiltersChange({ priority: value ? value.split(",") as TaskPriority[] : [] })
        }
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Prioridade" />
        </SelectTrigger>
        <SelectContent>
          {priorityOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Type Filter */}
      <Select
        value={filters.type.join(",")}
        onValueChange={(value: string) =>
          onFiltersChange({ type: value ? value.split(",") as TaskType[] : [] })
        }
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Tipo" />
        </SelectTrigger>
        <SelectContent>
          {typeOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Assignee Filter */}
      <Select
        value={filters.assignee}
        onValueChange={(value) => onFiltersChange({ assignee: value })}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Responsável" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">Todos</SelectItem>
          {assignees.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* AI Review Filter */}
      <Button
        variant={filters.awaitingAIReview ? "default" : "outline"}
        size="sm"
        onClick={() => onFiltersChange({ awaitingAIReview: !filters.awaitingAIReview })}
        className="gap-1"
      >
        <span className="flex items-center gap-1">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          Aguardando IA
        </span>
      </Button>

      {/* Clear Filters */}
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={() => onFiltersChange({
          search: "",
          status: [],
          priority: [],
          type: [],
          assignee: "",
          awaitingAIReview: false,
        })}>
          Limpar filtros
        </Button>
      )}
    </div>
  );
}