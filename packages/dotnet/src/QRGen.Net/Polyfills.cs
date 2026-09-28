// Copyright 2026 Rockyljewell
// SPDX-License-Identifier: Apache-2.0

#if NETSTANDARD2_0
// Enables C# 9+ init-only setters and records when targeting netstandard2.0.
namespace System.Runtime.CompilerServices
{
    internal static class IsExternalInit
    {
    }
}
#endif
