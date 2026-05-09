import { useState, useEffect } from 'react';

/**
 * useDebounce hook
 * 
 * Delays updating a value until a specified time has passed.
 * Useful for debouncing API calls or expensive operations.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}
