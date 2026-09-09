export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      bookings: {
        Row: {
          admin_notified_at: string | null
          booking_rate: Database["public"]["Enums"]["booking_rate"]
          cancel_notified_at: string | null
          canceled_at: string | null
          canceled_by: string | null
          cancellation_reason: string | null
          car_id: number
          created_at: string
          end_time: string
          id: string
          miles_driven: number | null
          pickup_location: string
          price_quote: Json | null
          refund_id: string | null
          refunded_amount: number | null
          start_time: string
          status: Database["public"]["Enums"]["booking_status"]
          stripe_payment_intent_id: string | null
          total_price: number
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_notified_at?: string | null
          booking_rate?: Database["public"]["Enums"]["booking_rate"]
          cancel_notified_at?: string | null
          canceled_at?: string | null
          canceled_by?: string | null
          cancellation_reason?: string | null
          car_id: number
          created_at?: string
          end_time: string
          id?: string
          miles_driven?: number | null
          pickup_location: string
          price_quote?: Json | null
          refund_id?: string | null
          refunded_amount?: number | null
          start_time: string
          status?: Database["public"]["Enums"]["booking_status"]
          stripe_payment_intent_id?: string | null
          total_price: number
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_notified_at?: string | null
          booking_rate?: Database["public"]["Enums"]["booking_rate"]
          cancel_notified_at?: string | null
          canceled_at?: string | null
          canceled_by?: string | null
          cancellation_reason?: string | null
          car_id?: number
          created_at?: string
          end_time?: string
          id?: string
          miles_driven?: number | null
          pickup_location?: string
          price_quote?: Json | null
          refund_id?: string | null
          refunded_amount?: number | null
          start_time?: string
          status?: Database["public"]["Enums"]["booking_status"]
          stripe_payment_intent_id?: string | null
          total_price?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      car_blocked_dates: {
        Row: {
          car_id: number
          created_at: string | null
          end_date: string
          id: string
          reason: string | null
          start_date: string
        }
        Insert: {
          car_id: number
          created_at?: string | null
          end_date: string
          id?: string
          reason?: string | null
          start_date: string
        }
        Update: {
          car_id?: number
          created_at?: string | null
          end_date?: string
          id?: string
          reason?: string | null
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "car_blocked_dates_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
        ]
      }
      car_price_overrides: {
        Row: {
          car_id: number
          created_at: string | null
          date: string
          id: string
          price: number
          updated_at: string | null
        }
        Insert: {
          car_id: number
          created_at?: string | null
          date: string
          id?: string
          price: number
          updated_at?: string | null
        }
        Update: {
          car_id?: number
          created_at?: string | null
          date?: string
          id?: string
          price?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "car_price_overrides_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
        ]
      }
      cars: {
        Row: {
          color: string | null
          created_at: string | null
          distance_fee: number | null
          features: Json | null
          fuel_type: string | null
          gallery_images: string[] | null
          id: number
          image_url: string | null
          is_available: boolean | null
          license_plate: string | null
          make: string
          model: string
          mpg: number | null
          num_seats: number | null
          price_per_day: number
          transmission: string | null
          trim: string | null
          updated_at: string | null
          year: number
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          distance_fee?: number | null
          features?: Json | null
          fuel_type?: string | null
          gallery_images?: string[] | null
          id?: never
          image_url?: string | null
          is_available?: boolean | null
          license_plate?: string | null
          make: string
          model: string
          mpg?: number | null
          num_seats?: number | null
          price_per_day: number
          transmission?: string | null
          trim?: string | null
          updated_at?: string | null
          year: number
        }
        Update: {
          color?: string | null
          created_at?: string | null
          distance_fee?: number | null
          features?: Json | null
          fuel_type?: string | null
          gallery_images?: string[] | null
          id?: never
          image_url?: string | null
          is_available?: boolean | null
          license_plate?: string | null
          make?: string
          model?: string
          mpg?: number | null
          num_seats?: number | null
          price_per_day?: number
          transmission?: string | null
          trim?: string | null
          updated_at?: string | null
          year?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address: string | null
          city: string | null
          created_at: string | null
          date_of_birth: string | null
          email: string | null
          full_name: string | null
          id: string
          identity_verified: boolean | null
          identity_verified_at: string | null
          is_admin: boolean | null
          num_trips: number | null
          phone: string | null
          state: string | null
          stripe_identity_session_id: string | null
          zip: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          identity_verified?: boolean | null
          identity_verified_at?: string | null
          is_admin?: boolean | null
          num_trips?: number | null
          phone?: string | null
          state?: string | null
          stripe_identity_session_id?: string | null
          zip?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          identity_verified?: boolean | null
          identity_verified_at?: string | null
          is_admin?: boolean | null
          num_trips?: number | null
          phone?: string | null
          state?: string | null
          stripe_identity_session_id?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      trip_media: {
        Row: {
          booking_id: string
          caption: string | null
          created_at: string
          duration_seconds: number | null
          height: number | null
          id: string
          kind: string
          mime_type: string
          size_bytes: number
          storage_path: string
          thumb_path: string | null
          uploaded_by: string | null
          width: number | null
        }
        Insert: {
          booking_id: string
          caption?: string | null
          created_at?: string
          duration_seconds?: number | null
          height?: number | null
          id?: string
          kind: string
          mime_type: string
          size_bytes: number
          storage_path: string
          thumb_path?: string | null
          uploaded_by?: string | null
          width?: number | null
        }
        Update: {
          booking_id?: string
          caption?: string | null
          created_at?: string
          duration_seconds?: number | null
          height?: number | null
          id?: string
          kind?: string
          mime_type?: string
          size_bytes?: number
          storage_path?: string
          thumb_path?: string | null
          uploaded_by?: string | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "trip_media_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_media_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      turo_bookings: {
        Row: {
          car_id: number
          end_time: string
          gmail_message_id: string
          id: string
          raw_subject: string | null
          renter_name: string | null
          start_time: string
          synced_at: string | null
          turo_trip_id: string | null
        }
        Insert: {
          car_id: number
          end_time: string
          gmail_message_id: string
          id?: string
          raw_subject?: string | null
          renter_name?: string | null
          start_time: string
          synced_at?: string | null
          turo_trip_id?: string | null
        }
        Update: {
          car_id?: number
          end_time?: string
          gmail_message_id?: string
          id?: string
          raw_subject?: string | null
          renter_name?: string | null
          start_time?: string
          synced_at?: string | null
          turo_trip_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "turo_bookings_car_id_fkey"
            columns: ["car_id"]
            isOneToOne: false
            referencedRelation: "cars"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auto_complete_bookings: { Args: never; Returns: undefined }
      can_access_trip_media: {
        Args: { target_booking_id: string }
        Returns: boolean
      }
      expire_stale_pending_bookings: { Args: never; Returns: undefined }
      get_available_cars: {
        Args: { end_ts: string; start_ts: string }
        Returns: {
          color: string | null
          created_at: string | null
          distance_fee: number | null
          features: Json | null
          fuel_type: string | null
          gallery_images: string[] | null
          id: number
          image_url: string | null
          is_available: boolean | null
          license_plate: string | null
          make: string
          model: string
          mpg: number | null
          num_seats: number | null
          price_per_day: number
          transmission: string | null
          trim: string | null
          updated_at: string | null
          year: number
        }[]
        SetofOptions: {
          from: "*"
          to: "cars"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_car_unavailability: {
        Args: { car_id_param: number }
        Returns: {
          end_time: string
          start_time: string
        }[]
      }
      is_admin: { Args: never; Returns: boolean }
    }
    Enums: {
      booking_rate: "non-refundable" | "refundable"
      booking_status:
        | "pending"
        | "confirmed"
        | "failed"
        | "canceled"
        | "completed"
        | "expired"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      booking_rate: ["non-refundable", "refundable"],
      booking_status: [
        "pending",
        "confirmed",
        "failed",
        "canceled",
        "completed",
        "expired",
      ],
    },
  },
} as const
