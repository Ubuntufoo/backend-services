interface SupabaseErrorLike {
  message: string;
}

export interface SingleResult<TData> {
  data: TData | null;
  error: SupabaseErrorLike | null;
}

export interface MultiResult<TData> {
  data: TData[] | null;
  error: SupabaseErrorLike | null;
}

export function requireSingleResult<TData>(
  result: SingleResult<TData>,
  missingMessage: string
): TData {
  if (result.error) {
    throw new Error(result.error.message);
  }

  if (result.data === null) {
    throw new Error(missingMessage);
  }

  return result.data;
}

export function requireOptionalResult<TData>(result: SingleResult<TData>): TData | null {
  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data;
}
