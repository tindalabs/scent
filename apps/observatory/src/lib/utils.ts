import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDate(d: string | Date): string {
  return new Date(d).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function formatDateShort(d: string | Date): string {
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function truncateId(id: string, len = 16): string {
  return id.length > len ? id.slice(0, len) + '…' : id;
}
