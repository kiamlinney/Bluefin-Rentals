import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from './supabase.server'

// Bridge for the Fleet Page
export const getCars = createServerFn({ method: 'GET' })
    .handler(async () => {
        const supabase = getSupabaseServerClient()
        const { data, error } = await supabase
            .from('cars')
            .select('*')
            .order('id', { ascending: true })

        if (error) throw new Error(error.message)
        return data
    })

// Bridge for the Car Details Page
export const getCarById = createServerFn({ method: 'GET' })
    .inputValidator((carId: string) => carId) // Decision: Validate that we received an ID
    .handler(async ({ data: carId }) => {
        const supabase = getSupabaseServerClient()
        const { data, error } = await supabase
            .from('cars')
            .select('*')
            .eq('id', carId)
            .single()

        if (error) throw new Error("Car not found")
        return data
    })