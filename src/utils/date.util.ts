import { BadRequestException } from '@nestjs/common';

export function parseDateOnly(dateInput?: string | Date): Date {
  const d = dateInput ? new Date(dateInput) : new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
  );
}

export function formatDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function getWeekRange(dateInput?: string | Date): {
  monday: Date;
  sunday: Date;
  dates: string[];
} {
  const target = dateInput ? new Date(dateInput) : new Date();
  const utcDate = new Date(
    Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      target.getUTCDate(),
    ),
  );
  const dayOfWeek = utcDate.getUTCDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const monday = new Date(utcDate);
  monday.setUTCDate(utcDate.getUTCDate() + diffToMonday);

  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(monday);
    cur.setUTCDate(monday.getUTCDate() + i);
    dates.push(formatDateString(cur));
  }

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return { monday, sunday, dates };
}

export function validateDateRange(
  startDate?: string | Date | null,
  endDate?: string | Date | null,
  errorMessage = 'Start date cannot be after end date',
): void {
  if (startDate && endDate) {
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();
    if (start > end) {
      throw new BadRequestException(errorMessage);
    }
  }
}

export function calculateDaysBetween(startDate: Date, endDate: Date): number {
  const diffMs = Math.abs(endDate.getTime() - startDate.getTime());
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

export function calculateDaysOverdue(
  dueDate?: string | Date | null,
  isResolvedOrCancelled = false,
): { isOverdue: boolean; daysOverdue: number } {
  if (!dueDate || isResolvedOrCancelled) {
    return { isOverdue: false, daysOverdue: 0 };
  }

  const now = new Date();
  const due = new Date(dueDate);

  if (due.getTime() < now.getTime()) {
    const diffMs = now.getTime() - due.getTime();
    const daysOverdue = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    return { isOverdue: true, daysOverdue };
  }

  return { isOverdue: false, daysOverdue: 0 };
}
