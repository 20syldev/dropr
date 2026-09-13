export type Matrix = number[][];
export interface MatrixResult {
    operation: string;
    result: Matrix | number;
    dimensions: {
        rows: number;
        cols: number;
    };
}
/**
 * Adds two matrices element-wise.
 *
 * @param matrix - First matrix (2D array of finite numbers)
 * @param matrix2 - Second matrix (must have the same dimensions as matrix)
 * @returns MatrixResult with the resulting matrix and its dimensions
 * @throws Error if either argument is not a valid matrix or dimensions do not match
 */
export declare function add(matrix: unknown, matrix2: unknown): MatrixResult;
/**
 * Subtracts the second matrix from the first element-wise.
 *
 * @param matrix - Matrix to subtract from (2D array of finite numbers)
 * @param matrix2 - Matrix to subtract (must have the same dimensions as matrix)
 * @returns MatrixResult with the resulting matrix and its dimensions
 * @throws Error if either argument is not a valid matrix or dimensions do not match
 */
export declare function subtract(matrix: unknown, matrix2: unknown): MatrixResult;
/**
 * Multiplies two matrices using standard matrix multiplication.
 *
 * @param matrix - Left-hand matrix (2D array of finite numbers)
 * @param matrix2 - Right-hand matrix; its row count must equal matrix's column count
 * @returns MatrixResult with the resulting matrix and its dimensions
 * @throws Error if either argument is not a valid matrix or inner dimensions are incompatible
 */
export declare function multiply(matrix: unknown, matrix2: unknown): MatrixResult;
/**
 * Multiplies every element of a matrix by a scalar value.
 *
 * @param matrix - Matrix to scale (2D array of finite numbers)
 * @param scalarVal - Finite number to multiply each element by
 * @returns MatrixResult with the scaled matrix and its dimensions
 * @throws Error if matrix is invalid or scalarVal is not a finite number
 */
export declare function scalar(matrix: unknown, scalarVal: unknown): MatrixResult;
/**
 * Transposes a matrix, swapping its rows and columns.
 *
 * @param matrix - Matrix to transpose (2D array of finite numbers)
 * @returns MatrixResult with the transposed matrix and its dimensions
 * @throws Error if matrix is not a valid 2D array of finite numbers
 */
export declare function transpose(matrix: unknown): MatrixResult;
/**
 * Computes the determinant of a square matrix using Gaussian elimination with partial pivoting.
 *
 * @param matrix - Square matrix (2D array of finite numbers)
 * @returns MatrixResult with the determinant as a scalar result and the input dimensions
 * @throws Error if matrix is not a valid square matrix
 */
export declare function determinant(matrix: unknown): MatrixResult;
/**
 * Computes the inverse of a square matrix using Gauss-Jordan elimination.
 *
 * @param matrix - Square matrix (2D array of finite numbers)
 * @returns MatrixResult with the inverted matrix and its dimensions
 * @throws Error if matrix is not a valid square matrix or is singular (determinant is 0)
 */
export declare function inverse(matrix: unknown): MatrixResult;
/**
 * Generates an n×n identity matrix.
 *
 * @param n - Size of the identity matrix (positive integer, max MAX_MATRIX_SIZE)
 * @returns MatrixResult with the identity matrix and its dimensions
 * @throws Error if n is not a positive integer or exceeds the maximum allowed size
 */
export declare function identity(n: unknown): MatrixResult;
